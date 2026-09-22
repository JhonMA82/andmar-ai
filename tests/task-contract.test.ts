import test from "node:test"
import assert from "node:assert/strict"
import {
  MAX_REVIEW_ROUNDS,
  buildReviewPacket,
  createTaskContract,
  evaluateRequirementGate,
  evaluateReviewGate,
  formatContractBrief,
  isBlockingFinding,
  isTrivialTask,
  recordRequirementEvidence,
  requiresIndependentReview,
  steerTaskContract,
  updateRequirementStatus,
  validateReviewResult,
  type ReviewRecord,
  type TaskContract,
} from "../src/core/task-contract.ts"
import { evaluateCompletionV2 } from "../src/core/lifecycle.ts"
import { taskContractCapability } from "../src/capabilities/task-contract/index.ts"
import { lifecycleCapability } from "../src/capabilities/lifecycle/index.ts"

function makeContract(): TaskContract {
  const created = createTaskContract("ses-1", {
    goal: "Port observability to OpenCode V2 keeping behavior",
    requirements: ["OpenCode V2 native", "keep dashboard", "update tests", "run real smoke"],
    constraints: ["do not touch Persona"],
  })
  assert.equal(created.ok, true)
  return (created as { ok: true; contract: TaskContract }).contract
}

function reviewRecord(round: number, verdict: "approve" | "reject", revision: string): ReviewRecord {
  return {
    verdict,
    findings: verdict === "approve" ? [] : [{ requirementId: "REQ-3", observation: "tests not updated", evidencePointer: "diff" }],
    round,
    reviewSessionID: `review-ses-${round}`,
    revision,
    at: round,
  }
}

// --- Contract creation: goal + requirements + constraints stored correctly ---

test("contract creation stores goal, requirements with REQ-N ids, and constraints with CON-N ids", () => {
  const contract = makeContract()
  assert.equal(contract.goal, "Port observability to OpenCode V2 keeping behavior")
  assert.deepEqual(
    contract.requirements.map((req) => req.id),
    ["REQ-1", "REQ-2", "REQ-3", "REQ-4"],
  )
  assert.deepEqual(contract.constraints.map((con) => con.id), ["CON-1"])
  assert.equal(contract.status, "active")
  for (const req of contract.requirements) assert.equal(req.status, "pending")
})

// --- Steering: new instruction updates the active contract, never resets ---

test("steering appends a constraint without dropping existing requirements", () => {
  const contract = makeContract()
  const steered = steerTaskContract(contract, { addConstraints: ["do not modify Persona"] })
  assert.equal(steered.ok, true)
  const next = (steered as { ok: true; contract: TaskContract }).contract
  assert.equal(next.requirements.length, 4)
  assert.deepEqual(next.requirements.map((req) => req.id), ["REQ-1", "REQ-2", "REQ-3", "REQ-4"])
  assert.equal(next.constraints.length, 2)
  assert.equal(next.constraints[1]?.id, "CON-2")
})

test("steering a completed contract is refused", () => {
  const contract = { ...makeContract(), status: "completed" as const }
  const steered = steerTaskContract(contract, { addConstraints: ["new rule"] })
  assert.equal(steered.ok, false)
})

// --- Pending gate: REQ-2 pending -> completion denied ---

test("pending requirements deny completion", () => {
  const contract = makeContract()
  const gate = evaluateRequirementGate(contract, "rev-a")
  assert.equal(gate.ok, false)
  assert.deepEqual(gate.pending, ["REQ-1", "REQ-2", "REQ-3", "REQ-4"])
})

// --- Evidence requirement: satisfied without evidence -> invalid ---

test("satisfied requirement without evidence is invalid", () => {
  let contract = makeContract()
  contract = (updateRequirementStatus(contract, "REQ-1", "satisfied") as { ok: true; contract: TaskContract }).contract
  const gate = evaluateRequirementGate(contract, "rev-a")
  assert.equal(gate.ok, false)
  assert.deepEqual(gate.missingEvidence, ["REQ-1"])
})

test("satisfied requirement with current-revision evidence passes its own check", () => {
  let contract = makeContract()
  for (const id of ["REQ-1", "REQ-2", "REQ-3", "REQ-4"]) {
    contract = (
      recordRequirementEvidence(contract, id, { type: "verification", reference: "tests", revision: "rev-a" }) as {
        ok: true
        contract: TaskContract
      }
    ).contract
    contract = (updateRequirementStatus(contract, id, "satisfied") as { ok: true; contract: TaskContract }).contract
  }
  const gate = evaluateRequirementGate(contract, "rev-a")
  assert.equal(gate.ok, true)
  assert.equal(gate.satisfied, 4)
})

// --- Blocked requirement -> completion false ---

test("blocked requirement denies completion", () => {
  let contract = makeContract()
  const updated = updateRequirementStatus(contract, "REQ-2", "blocked", "no runtime available")
  assert.equal(updated.ok, true)
  contract = (updated as { ok: true; contract: TaskContract }).contract
  const gate = evaluateRequirementGate(contract, "rev-a")
  assert.equal(gate.ok, false)
  assert.deepEqual(gate.blocked, ["REQ-2"])
  // Reopening clears the stale block reason.
  contract = (updateRequirementStatus(contract, "REQ-2", "pending") as { ok: true; contract: TaskContract }).contract
  assert.equal(contract.requirements[1]?.reason, undefined)
})

test("blocked and skipped transitions require a reason", () => {
  const contract = makeContract()
  assert.equal(updateRequirementStatus(contract, "REQ-1", "blocked").ok, false)
  assert.equal(updateRequirementStatus(contract, "REQ-1", "skipped").ok, false)
  assert.equal(updateRequirementStatus(contract, "REQ-1", "satisfied").ok, true)
})

// --- Revision staleness: evidence revision A vs current B -> stale ---

test("revision-bound evidence for another revision is stale", () => {
  let contract = makeContract()
  contract = (
    recordRequirementEvidence(contract, "REQ-1", { type: "verification", reference: "tests", revision: "rev-a" }) as {
      ok: true
      contract: TaskContract
    }
  ).contract
  contract = (updateRequirementStatus(contract, "REQ-1", "satisfied") as { ok: true; contract: TaskContract }).contract
  const gate = evaluateRequirementGate(contract, "rev-b")
  assert.equal(gate.ok, false)
  assert.deepEqual(gate.stale, ["REQ-1"])
})

// --- Review required: non-trivial code task without review -> denied ---

test("required review without any recorded review denies completion", () => {
  const contract = makeContract()
  const gate = evaluateReviewGate(contract, [], "rev-a", true)
  assert.equal(gate.ok, false)
  assert.match(gate.reasons.join(" "), /no review recorded/)
})

test("review rejection denies completion", () => {
  const contract = makeContract()
  const gate = evaluateReviewGate(contract, [reviewRecord(1, "reject", "rev-a")], "rev-a", true)
  assert.equal(gate.ok, false)
  assert.match(gate.reasons.join(" "), /rejected/)
  assert.equal(gate.rejectCount, 1)
})

test("current approved review passes the review gate", () => {
  const contract = makeContract()
  const gate = evaluateReviewGate(contract, [reviewRecord(1, "approve", "rev-a")], "rev-a", true)
  assert.equal(gate.ok, true)
})

test("stale review revision denies completion", () => {
  const contract = makeContract()
  const gate = evaluateReviewGate(contract, [reviewRecord(1, "approve", "rev-a")], "rev-b", true)
  assert.equal(gate.ok, false)
  assert.match(gate.reasons.join(" "), /not the current revision/)
})

// --- Fresh second review: session #1 != session #2; max 2 rounds -> blocked ---

test("second review round uses a different session and two rejects block the task", () => {
  const contract = makeContract()
  const reviews = [reviewRecord(1, "reject", "rev-a"), reviewRecord(2, "reject", "rev-b")]
  assert.notEqual(reviews[0]?.reviewSessionID, reviews[1]?.reviewSessionID)
  const gate = evaluateReviewGate(contract, reviews, "rev-b", true)
  assert.equal(gate.ok, false)
  assert.equal(gate.exhausted, true)
  assert.equal(gate.rounds, MAX_REVIEW_ROUNDS)
  assert.match(gate.reasons.join(" "), /blocked/)
})

// --- Review findings only block when linked to a real requirement/constraint ---

test("unlinked findings are advisory while linked findings block", () => {
  const contract = makeContract()
  assert.equal(
    isBlockingFinding(contract, { requirementId: "REQ-3", observation: "missed", evidencePointer: "diff" }),
    true,
  )
  assert.equal(
    isBlockingFinding(contract, { constraintId: "CON-1", observation: "touched Persona", evidencePointer: "diff" }),
    true,
  )
  assert.equal(isBlockingFinding(contract, { observation: "I would organize files differently", evidencePointer: "taste" }), false)
})

test("invalid reviewer output never becomes success", () => {
  assert.equal(validateReviewResult({ verdict: "approve", findings: "yes" }).ok, false)
  assert.equal(validateReviewResult({ verdict: "maybe", findings: [] }).ok, false)
  assert.equal(
    validateReviewResult({ verdict: "approve", findings: [{ observation: "ok", evidencePointer: "diff" }] }).ok,
    true,
  )
})

test("reviewer verdict variants normalize to the canonical enum", () => {
  assert.equal(validateReviewResult({ verdict: "APPROVE", findings: [] }).ok, true)
  assert.equal(validateReviewResult({ verdict: "APPROVE", findings: [] } as any).result.verdict, "approve")
  assert.equal(validateReviewResult({ verdict: "Rejected.", findings: [] }).ok, true)
  assert.equal(validateReviewResult({ verdict: "rejected", findings: [] } as any).result.verdict, "reject")
  assert.equal(validateReviewResult({ verdict: "approved ", findings: [] }).ok, true)
  assert.equal(validateReviewResult({ verdict: "maybe", findings: [] }).ok, false)
  assert.equal(validateReviewResult({ verdict: "OK", findings: [] }).ok, false)
})

test("review packet demands a strict lowercase verdict and read-only reviewer", () => {
  const packet = buildReviewPacket(makeContract(), { revision: "rev-a" })
  assert.match(packet, /read-only/i)
  assert.match(packet, /exactly the lowercase string "approve" or "reject"/)
})

// --- Trivial task: no mandatory contract/reviewer ceremony ---

test("tiny documentation change needs no contract or review ceremony", () => {
  assert.equal(isTrivialTask("docs-format", 1), true)
  assert.equal(isTrivialTask("feature", 1), false)
  assert.equal(requiresIndependentReview("docs-format"), false)
  assert.equal(requiresIndependentReview("feature"), true)
  assert.equal(requiresIndependentReview(undefined), true)
})

// --- Completion V2: full composition ---

test("completion V2 passes only with verification, contract and review all green", () => {
  let contract = makeContract()
  for (const id of ["REQ-1", "REQ-2", "REQ-3", "REQ-4"]) {
    contract = (
      recordRequirementEvidence(contract, id, { type: "verification", reference: "tests", revision: "rev-a" }) as {
        ok: true
        contract: TaskContract
      }
    ).contract
    contract = (updateRequirementStatus(contract, id, "satisfied") as { ok: true; contract: TaskContract }).contract
  }
  const evidence = { revision: "rev-a", testsPassed: true, docsStatus: "clean" as const, versionStatus: "clean" as const }
  const verification = { ok: true, missing: [], failed: [], unverified: [], reasons: [] }
  const contractGate = evaluateRequirementGate(contract, "rev-a")
  const reviewGate = evaluateReviewGate(contract, [reviewRecord(1, "approve", "rev-a")], "rev-a", true)
  assert.equal(evaluateCompletionV2("rev-a", evidence, verification, ["tests"], contractGate, reviewGate).ok, true)

  const pendingGate = evaluateRequirementGate(makeContract(), "rev-a")
  assert.equal(evaluateCompletionV2("rev-a", evidence, verification, ["tests"], pendingGate, reviewGate).ok, false)
})

// --- Review packet stays compact: no transcript, bounded context ---

test("review packet carries goal, requirements, constraints and revision without transcript", () => {
  const packet = buildReviewPacket(makeContract(), { revision: "rev-a", changedPaths: ["src/a.ts"] })
  assert.match(packet, /Original goal/)
  assert.match(packet, /REQ-1/)
  assert.match(packet, /CON-1/)
  assert.match(packet, /rev-a/)
  assert.match(packet, /ONLY one JSON object/)
  assert.ok(packet.length < 6000)
})

test("contract brief is a compact projection for post-compaction continuity", () => {
  const brief = formatContractBrief(makeContract(), [])
  assert.match(brief, /Goal:/)
  assert.match(brief, /REQ-1 pending/)
  assert.match(brief, /CON-1 constraint/)
})

// ---------------------------------------------------------------------------
// Capability-level flow: task_contract ops through the tool harness.
// ---------------------------------------------------------------------------

function createMemoryState() {
  const map = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return map.get(key) as T | undefined
    },
    async set<T>(key: string, value: T): Promise<void> {
      map.set(key, value)
    },
    async remove(key: string): Promise<void> {
      map.delete(key)
    },
    async scan<T>(prefix: string): Promise<Array<{ key: string; value: T }>> {
      const out: Array<{ key: string; value: T }> = []
      for (const [key, value] of map.entries()) {
        if (key.startsWith(prefix)) out.push({ key, value: value as T })
      }
      return out
    },
  }
}

function createToolHarness() {
  const tools = new Map<string, any>()
  const ctx: any = {
    tool: {
      async transform(cb: (editor: any) => void) {
        const editor = {
          namespace() {},
          add(def: any) {
            tools.set(def.name, def)
          },
        }
        cb(editor)
        return { dispose() {} }
      },
    },
    session: {
      async get() {
        return { model: undefined }
      },
      async create(input: any) {
        return { id: `child-${Math.random().toString(36).slice(2)}`, ...input }
      },
      async prompt() {
        return { parts: [] }
      },
    },
  }
  return { ctx, tools }
}

test("task_contract tool: create refuses duplicate active contracts and status projects the brief", async () => {
  const state: any = createMemoryState()
  const { ctx, tools } = createToolHarness()
  await taskContractCapability.setup({ ctx, config: { models: {} } as any, state })
  const tool = tools.get("task_contract")
  assert.ok(tool)

  const created: any = await tool.execute(
    { op: "create", goal: "Add --json flag", requirements: ["keep default output", "update tests"] },
    { sessionID: "ses-1" },
  )
  assert.match(created.content, /"stored": true/)
  assert.match(created.content, /REQ-1/)

  const duplicate: any = await tool.execute(
    { op: "create", goal: "Other goal", requirements: ["other"] },
    { sessionID: "ses-1" },
  )
  assert.match(duplicate.content, /^refused:/)

  // Steering (new user instruction) appends without replacing.
  const steered: any = await tool.execute(
    { op: "steer", addConstraints: ["do not touch other commands"] },
    { sessionID: "ses-1" },
  )
  assert.match(steered.content, /"stored": true/)
  assert.match(steered.content, /CON-1/)

  const status: any = await tool.execute({ op: "status" }, { sessionID: "ses-1" })
  const summary = JSON.parse(status.content)
  assert.equal(summary.active, true)
  assert.match(summary.brief, /Add --json flag/)
  assert.equal(summary.metrics.requirementsPending, 2)
})

test("request_review stores approve in a fresh session; second round uses another session", async () => {
  const state: any = createMemoryState()
  const createdSessions: string[] = []
  const { ctx, tools } = createToolHarness()
  let promptCount = 0
  ctx.session.create = async (input: any) => {
    const id = `review-ses-${createdSessions.length + 1}`
    createdSessions.push(id)
    return { id, ...input }
  }
  ctx.session.prompt = async () => {
    promptCount += 1
    if (promptCount === 1) {
      return { text: JSON.stringify({ verdict: "reject", findings: [{ requirementId: "REQ-1", observation: "missing", evidencePointer: "diff" }] }) }
    }
    return { text: JSON.stringify({ verdict: "approve", findings: [] }) }
  }
  await taskContractCapability.setup({ ctx, config: { models: {} } as any, state })
  const contract = tools.get("task_contract")
  await contract.execute({ op: "create", goal: "Add --json flag", requirements: ["keep default output"] }, { sessionID: "ses-1" })
  const review = tools.get("request_review")

  const first: any = await review.execute({ revision: "rev-a" }, { sessionID: "ses-1" })
  assert.match(first.content, /"stored": true/)
  const second: any = await review.execute({ revision: "rev-b" }, { sessionID: "ses-1" })
  assert.match(second.content, /"stored": true/)
  assert.notEqual(createdSessions[0], createdSessions[1])

  const third: any = await review.execute({ revision: "rev-c" }, { sessionID: "ses-1" })
  assert.match(third.content, /^blocked:/)
})

test("request_review reads the reviewer answer through the real prompt->wait->context contract", async () => {
  const state: any = createMemoryState()
  const { ctx, tools } = createToolHarness()
  let waited = 0
  ctx.session.wait = async () => {
    waited += 1
    return undefined
  }
  // Real V2 shape: assistant messages carry `content` items, not `parts`.
  ctx.session.context = async () => [
    {
      type: "assistant",
      time: { created: Date.now(), completed: Date.now() },
      content: [{ type: "text", text: JSON.stringify({ verdict: "approve", findings: [] }) }],
    },
  ]
  await taskContractCapability.setup({ ctx, config: { models: {} } as any, state })
  const contract = tools.get("task_contract")
  await contract.execute({ op: "create", goal: "Add --json flag", requirements: ["keep default output"] }, { sessionID: "ses-1" })
  const review: any = await tools.get("request_review").execute({ revision: "rev-a" }, { sessionID: "ses-1" })
  assert.match(review.content, /"stored": true/)
  assert.match(review.content, /"verdict": "approve"/)
  assert.ok(waited >= 1)
})

test("concurrent contract mutations are serialized instead of last-write-wins", async () => {
  const state: any = createMemoryState()
  const { ctx, tools } = createToolHarness()
  await taskContractCapability.setup({ ctx, config: { models: {} } as any, state })
  const contract = tools.get("task_contract")
  await contract.execute(
    { op: "create", goal: "Add --json flag", requirements: ["keep default output", "update tests", "update README"] },
    { sessionID: "ses-1" },
  )
  // Fire three evidence+update pairs concurrently; the per-session write
  // lock must preserve every requirement's evidence and status.
  await Promise.all([
    contract.execute({ op: "record_evidence", requirementId: "REQ-1", type: "diff", reference: "git diff" }, { sessionID: "ses-1" }),
    contract.execute({ op: "record_evidence", requirementId: "REQ-2", type: "verification", reference: "tests" }, { sessionID: "ses-1" }),
    contract.execute({ op: "record_evidence", requirementId: "REQ-3", type: "diff", reference: "README" }, { sessionID: "ses-1" }),
    contract.execute({ op: "update", requirementId: "REQ-1", status: "satisfied" }, { sessionID: "ses-1" }),
    contract.execute({ op: "update", requirementId: "REQ-2", status: "satisfied" }, { sessionID: "ses-1" }),
    contract.execute({ op: "update", requirementId: "REQ-3", status: "satisfied" }, { sessionID: "ses-1" }),
  ])
  const status: any = await contract.execute({ op: "status" }, { sessionID: "ses-1" })
  const summary = JSON.parse(status.content)
  assert.equal(summary.metrics.requirementsSatisfied, 3)
  for (const req of summary.contract.requirements) {
    assert.equal(req.status, "satisfied", `${req.id} lost its update`)
    assert.ok(req.evidence.length >= 1, `${req.id} lost its evidence`)
  }
})

test("delegation-free reviewer: invalid review output consumes no round even through wait/context", async () => {
  const state: any = createMemoryState()
  const { ctx, tools } = createToolHarness()
  ctx.session.wait = async () => undefined
  ctx.session.context = async () => [
    {
      type: "assistant",
      time: { created: Date.now(), completed: Date.now() },
      content: [{ type: "text", text: "I could not decide, sorry." }],
    },
  ]
  await taskContractCapability.setup({ ctx, config: { models: {} } as any, state })
  const contract = tools.get("task_contract")
  await contract.execute({ op: "create", goal: "Add --json flag", requirements: ["keep default output"] }, { sessionID: "ses-1" })
  const result: any = await tools.get("request_review").execute({ revision: "rev-a" }, { sessionID: "ses-1" })
  assert.match(result.content, /^invalid reviewer output/)
  const stored = await state.scan("task-contract-review/")
  assert.equal(stored.length, 0)
})

test("request_review with invalid reviewer output stores nothing and consumes no round", async () => {
  const state: any = createMemoryState()
  const { ctx, tools } = createToolHarness()
  ctx.session.create = async (input: any) => ({ id: "review-ses-1", ...input })
  ctx.session.prompt = async () => ({ text: "looks good to me, ship it" })
  await taskContractCapability.setup({ ctx, config: { models: {} } as any, state })
  const contract = tools.get("task_contract")
  await contract.execute({ op: "create", goal: "Add --json flag", requirements: ["keep default output"] }, { sessionID: "ses-1" })
  const result: any = await tools.get("request_review").execute({ revision: "rev-a" }, { sessionID: "ses-1" })
  assert.match(result.content, /^invalid reviewer output/)
  const stored = await state.scan("task-contract-review/")
  assert.equal(stored.length, 0)
})

// --- Negative smoke: tests pass + verification passes, but a required
// README requirement is still pending -> completion DENIED. ---

test("negative smoke: green tests cannot complete a task with a pending README requirement", async () => {
  const state: any = createMemoryState()
  const harness = createToolHarness()
  await taskContractCapability.setup({ ctx: harness.ctx, config: { models: {} } as any, state })
  const contract = harness.tools.get("task_contract")
  await contract.execute(
    {
      op: "create",
      goal: "Add --json flag to command X",
      requirements: ["keep default output", "update tests", "update README", "run real smoke"],
    },
    { sessionID: "ses-1" },
  )
  // Satisfy everything except the README requirement.
  for (const id of ["REQ-1", "REQ-2", "REQ-4"]) {
    await contract.execute(
      { op: "record_evidence", requirementId: id, type: "verification", reference: "tests", revision: "rev-a" },
      { sessionID: "ses-1" },
    )
    await contract.execute({ op: "update", requirementId: id, status: "satisfied" }, { sessionID: "ses-1" })
  }

  // Verification fully green for the same revision (crafted receipts backed
  // by completed same-session executions, as the verification capability
  // would store them).
  await state.set("verification/rev-a/tests", {
    revision: "rev-a",
    check: "tests",
    passed: true,
    at: 1,
    command: "bun test",
    sessionID: "ses-1",
    executionId: "exec-tests",
  })
  await state.set("verification/rev-a/typecheck", {
    revision: "rev-a",
    check: "typecheck",
    passed: true,
    at: 2,
    command: "bunx tsc --noEmit",
    sessionID: "ses-1",
    executionId: "exec-type",
  })
  await state.set("verification-evidence/exec-tests", {
    executionId: "exec-tests",
    tool: "bash",
    status: "completed",
    sessionID: "ses-1",
    at: 1,
    command: "bun test",
    commandNormalized: "bun test",
    revision: "rev-a",
  })
  await state.set("verification-evidence/exec-type", {
    executionId: "exec-type",
    tool: "bash",
    status: "completed",
    sessionID: "ses-1",
    at: 2,
    command: "bunx tsc --noEmit",
    commandNormalized: "bunx tsc --noEmit",
    revision: "rev-a",
  })

  const lHarness = createToolHarness()
  await lifecycleCapability.setup({
    ctx: lHarness.ctx,
    config: { documentation: { rules: [] }, versioning: { enabled: false, publicPaths: [] } } as any,
    state,
  })
  const gate = lHarness.tools.get("completion_gate")
  const clean = { revision: "rev-a", testsPassed: true, docsStatus: "clean", versionStatus: "not-applicable" }
  const denied: any = await gate.execute(
    { currentRevision: "rev-a", evidence: clean, requiredChecks: ["tests", "typecheck"] },
    { sessionID: "ses-1" },
  )
  const deniedJson = JSON.parse(denied.content)
  assert.equal(deniedJson.ok, false)
  assert.match(deniedJson.reasons.join(" "), /task contract: pending requirements: REQ-3/)
})

// --- Positive smoke: all requirements satisfied with evidence plus an
// approved current review -> completion passes. ---

test("positive smoke: full contract plus approved review completes", async () => {
  const state: any = createMemoryState()
  const harness = createToolHarness()
  harness.ctx.session.create = async (input: any) => ({ id: "review-ses-1", ...input })
  harness.ctx.session.prompt = async () => ({ text: JSON.stringify({ verdict: "approve", findings: [] }) })
  await taskContractCapability.setup({ ctx: harness.ctx, config: { models: {} } as any, state })
  const contract = harness.tools.get("task_contract")
  await contract.execute(
    { op: "create", goal: "Add --json flag", requirements: ["keep default output", "update tests"] },
    { sessionID: "ses-1" },
  )
  for (const id of ["REQ-1", "REQ-2"]) {
    await contract.execute(
      { op: "record_evidence", requirementId: id, type: "verification", reference: "tests", revision: "rev-a" },
      { sessionID: "ses-1" },
    )
    await contract.execute({ op: "update", requirementId: id, status: "satisfied" }, { sessionID: "ses-1" })
  }
  const review: any = await harness.tools
    .get("request_review")
    .execute({ revision: "rev-a", changedPaths: ["src/x.ts"] }, { sessionID: "ses-1" })
  assert.match(review.content, /"stored": true/)

  await state.set("verification/rev-a/tests", {
    revision: "rev-a",
    check: "tests",
    passed: true,
    at: 1,
    command: "bun test",
    sessionID: "ses-1",
    executionId: "exec-tests",
  })
  await state.set("verification/rev-a/typecheck", {
    revision: "rev-a",
    check: "typecheck",
    passed: true,
    at: 2,
    command: "bunx tsc --noEmit",
    sessionID: "ses-1",
    executionId: "exec-type",
  })
  await state.set("verification-evidence/exec-tests", {
    executionId: "exec-tests",
    tool: "bash",
    status: "completed",
    sessionID: "ses-1",
    at: 1,
    command: "bun test",
    commandNormalized: "bun test",
    revision: "rev-a",
  })
  await state.set("verification-evidence/exec-type", {
    executionId: "exec-type",
    tool: "bash",
    status: "completed",
    sessionID: "ses-1",
    at: 2,
    command: "bunx tsc --noEmit",
    commandNormalized: "bunx tsc --noEmit",
    revision: "rev-a",
  })

  const lHarness = createToolHarness()
  await lifecycleCapability.setup({
    ctx: lHarness.ctx,
    config: { documentation: { rules: [] }, versioning: { enabled: false, publicPaths: [] } } as any,
    state,
  })
  const clean = { revision: "rev-a", testsPassed: true, docsStatus: "clean", versionStatus: "not-applicable" }
  const passed: any = await lHarness.tools
    .get("completion_gate")
    .execute({ currentRevision: "rev-a", evidence: clean, requiredChecks: ["tests", "typecheck"] }, { sessionID: "ses-1" })
  assert.equal(JSON.parse(passed.content).ok, true)
})

test("completion gate without a contract keeps legacy behavior for trivial tasks", async () => {
  const state: any = createMemoryState()
  const lHarness = createToolHarness()
  await lifecycleCapability.setup({
    ctx: lHarness.ctx,
    config: { documentation: { rules: [] }, versioning: { enabled: false, publicPaths: [] } } as any,
    state,
  })
  const clean = { revision: "rev-a", testsPassed: true, docsStatus: "clean", versionStatus: "not-applicable" }
  const trivial: any = await lHarness.tools
    .get("completion_gate")
    .execute({ currentRevision: "rev-a", evidence: clean, requiredChecks: [] }, { sessionID: "ses-1" })
  assert.equal(JSON.parse(trivial.content).ok, true)

  const demanded: any = await lHarness.tools
    .get("completion_gate")
    .execute({ currentRevision: "rev-a", evidence: clean, requiredChecks: [], requireContract: true }, { sessionID: "ses-1" })
  const demandedJson = JSON.parse(demanded.content)
  assert.equal(demandedJson.ok, false)
  assert.match(demandedJson.reasons.join(" "), /no Task Contract/)
})
