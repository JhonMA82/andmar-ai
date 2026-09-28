import test from "node:test"
import assert from "node:assert/strict"
import {
  MAX_REQUIREMENTS,
  contractStateToken,
  createTaskContract,
  evaluateRequirementGate,
  formatContractBrief,
  isTrivialTask,
  recordRequirementEvidence,
  steerTaskContract,
  updateRequirementStatus,
  type TaskContract,
} from "../src/core/task-contract.ts"
import { evaluateCompletionV2 } from "../src/core/lifecycle.ts"
import { taskContractCapability } from "../src/capabilities/task-contract/index.ts"

function makeContract(): TaskContract {
  const created = createTaskContract("ses-1", {
    taskKind: "feature",
    goal: "Port observability to OpenCode V2 keeping behavior",
    requirements: ["OpenCode V2 native", "keep dashboard", "update tests", "run real smoke"],
    constraints: ["do not touch Persona"],
  })
  assert.equal(created.ok, true)
  return (created as { ok: true; contract: TaskContract }).contract
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

// --- Trivial task: no mandatory contract ceremony ---

test("tiny documentation change needs no contract ceremony", () => {
  assert.equal(isTrivialTask("docs-format", 1), true)
  assert.equal(isTrivialTask("feature", 1), false)
  assert.equal(isTrivialTask("security", 1), false)
  assert.equal(isTrivialTask("migration", 1), false)
  assert.equal(isTrivialTask("architecture", 1), false)
  assert.equal(isTrivialTask(undefined), false)
})

// --- Completion V2: full composition ---

test("completion V2 passes only with exact-revision verification and a green requirement gate", () => {
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
  assert.equal(evaluateCompletionV2("rev-a", evidence, verification, ["tests"], contractGate).ok, true)

  const pendingGate = evaluateRequirementGate(makeContract(), "rev-a")
  assert.equal(evaluateCompletionV2("rev-a", evidence, verification, ["tests"], pendingGate).ok, false)
})

test("completion V2 still blocks when required verification is missing", () => {
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
  const unverified = {
    ok: false,
    missing: [],
    failed: [],
    unverified: ["tests"],
    reasons: ["unverified receipts (no valid completed same-revision execution): tests"],
  }
  const contractGate = evaluateRequirementGate(contract, "rev-a")
  const result = evaluateCompletionV2("rev-a", evidence, unverified, ["tests"], contractGate)
  assert.equal(result.ok, false)
  assert.match(result.reasons.join(" "), /required verification/)
})

test("contract brief is a compact projection for post-compaction continuity", () => {
  const brief = formatContractBrief(makeContract())
  assert.match(brief, /Goal:/)
  assert.match(brief, /REQ-1 pending/)
  assert.match(brief, /CON-1 constraint/)
})

// --- The independent-review subsystem no longer exists. ---

test("task-contract exposes contract + completion only, with no review tool or child session", async () => {
  const state: any = createMemoryState()
  const { ctx, tools } = createToolHarness()
  let createdSessions = 0
  ctx.session.create = async (input: any) => {
    createdSessions += 1
    return { id: `unexpected-child-${createdSessions}`, ...input }
  }
  await taskContractCapability.setup({ ctx, config: { models: {} } as any, state })
  assert.deepEqual([...tools.keys()].sort(), ["completion_gate", "task_contract"])
  assert.equal(tools.get("request_review"), undefined)
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
    { op: "create", taskKind: "feature", goal: "Add --json flag", requirements: ["keep default output", "update tests"] },
    { sessionID: "ses-1" },
  )
  assert.match(created.content, /"stored": true/)
  assert.match(created.content, /REQ-1/)

  const duplicate: any = await tool.execute(
    { op: "create", taskKind: "feature", goal: "Other goal", requirements: ["other"] },
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

test("concurrent contract mutations are serialized instead of last-write-wins", async () => {
  const state: any = createMemoryState()
  const { ctx, tools } = createToolHarness()
  await taskContractCapability.setup({ ctx, config: { models: {} } as any, state })
  const contract = tools.get("task_contract")
  await contract.execute(
    { op: "create", taskKind: "feature", goal: "Add --json flag", requirements: ["keep default output", "update tests", "update README"] },
    { sessionID: "ses-1" },
  )
  // Fire three evidence+update pairs concurrently; the per-session write
  // lock must preserve every requirement's evidence and status.
  await Promise.all([
    contract.execute({ op: "record_evidence", requirementId: "REQ-1", type: "diff", reference: "git diff", revision: "rev-a" }, { sessionID: "ses-1" }),
    contract.execute({ op: "record_evidence", requirementId: "REQ-2", type: "verification", reference: "tests", revision: "rev-a" }, { sessionID: "ses-1" }),
    contract.execute({ op: "record_evidence", requirementId: "REQ-3", type: "diff", reference: "README", revision: "rev-a" }, { sessionID: "ses-1" }),
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

test("negative smoke: green tests cannot complete a task with a pending README requirement", async () => {
  const state: any = createMemoryState()
  const harness = createToolHarness()
  await taskContractCapability.setup({ ctx: harness.ctx, config: { models: {} } as any, state })
  const contract = harness.tools.get("task_contract")
  await contract.execute(
    {
      op: "create",
      taskKind: "feature",
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
  await taskContractCapability.setup({
    ctx: lHarness.ctx,
    config: { documentation: { rules: [] }, versioning: { enabled: false, publicPaths: [] } } as any,
    state,
  })
  const gate = lHarness.tools.get("completion_gate")
  const clean = { revision: "rev-a", testsPassed: true, docsStatus: "clean", versionStatus: "not-applicable" }
  const denied: any = await gate.execute(
    { taskKind: "feature", currentRevision: "rev-a", evidence: clean, requiredChecks: ["tests", "typecheck"] },
    { sessionID: "ses-1" },
  )
  const deniedJson = JSON.parse(denied.content)
  assert.equal(deniedJson.ok, false)
  assert.match(deniedJson.reasons.join(" "), /task contract: pending requirements: REQ-3/)
})

// --- Positive smoke: ordinary code completes from requirements + exact-
// revision verification. No second LLM judges completion. ---

test("positive smoke: ordinary feature completes from requirements and exact-revision verification", async () => {
  const state: any = createMemoryState()
  const harness = createToolHarness()
  await taskContractCapability.setup({ ctx: harness.ctx, config: { models: {} } as any, state })
  const contract = harness.tools.get("task_contract")
  await contract.execute(
    { op: "create", taskKind: "feature", goal: "Add --json flag", requirements: ["keep default output", "update tests"] },
    { sessionID: "ses-1" },
  )
  for (const id of ["REQ-1", "REQ-2"]) {
    await contract.execute(
      { op: "record_evidence", requirementId: id, type: "verification", reference: "tests", revision: "rev-a" },
      { sessionID: "ses-1" },
    )
    await contract.execute({ op: "update", requirementId: id, status: "satisfied" }, { sessionID: "ses-1" })
  }
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
  await taskContractCapability.setup({
    ctx: lHarness.ctx,
    config: { documentation: { rules: [] }, versioning: { enabled: false, publicPaths: [] } } as any,
    state,
  })
  const clean = { revision: "rev-a", testsPassed: true, docsStatus: "clean", versionStatus: "not-applicable" }
  const passed: any = await lHarness.tools
    .get("completion_gate")
    .execute({ taskKind: "feature", currentRevision: "rev-a", evidence: clean, requiredChecks: ["tests", "typecheck"] }, { sessionID: "ses-1" })
  const parsed = JSON.parse(passed.content)
  assert.equal(parsed.ok, true)
  assert.equal("review" in parsed, false)
})

// Removing Review must not create a bypass: a manual `testsPassed: true`
// claim still cannot replace stored exact-revision Verification.
test("negative smoke: a green contract with clean docs/version is still denied without exact-revision verification", async () => {
  const state: any = createMemoryState()
  const harness = createToolHarness()
  await taskContractCapability.setup({ ctx: harness.ctx, config: { models: {} } as any, state })
  const contract = harness.tools.get("task_contract")
  await contract.execute(
    { op: "create", taskKind: "feature", goal: "Add --json flag", requirements: ["keep default output", "update tests"] },
    { sessionID: "ses-unverified" },
  )
  for (const id of ["REQ-1", "REQ-2"]) {
    await contract.execute(
      { op: "record_evidence", requirementId: id, type: "diff", reference: "src/x.ts", revision: "rev-a" },
      { sessionID: "ses-unverified" },
    )
    await contract.execute({ op: "update", requirementId: id, status: "satisfied" }, { sessionID: "ses-unverified" })
  }
  // Deliberately no `verification/rev-a/*` receipts and no
  // `verification-evidence/*` entries: the caller still claims testsPassed.

  const lHarness = createToolHarness()
  await taskContractCapability.setup({
    ctx: lHarness.ctx,
    config: { documentation: { rules: [] }, versioning: { enabled: false, publicPaths: [] } } as any,
    state,
  })
  const denied: any = await lHarness.tools.get("completion_gate").execute(
    {
      taskKind: "feature",
      currentRevision: "rev-a",
      evidence: { revision: "rev-a", testsPassed: true, docsStatus: "clean", versionStatus: "not-applicable" },
      requiredChecks: ["tests", "typecheck"],
    },
    { sessionID: "ses-unverified" },
  )
  const parsed = JSON.parse(denied.content)
  assert.equal(parsed.ok, false)
  assert.equal(parsed.contractClosed, false)
  assert.match(parsed.reasons.join(" "), /required verification/)
  assert.match(parsed.reasons.join(" "), /missing receipts/)

  const status: any = await contract.execute({ op: "status" }, { sessionID: "ses-unverified" })
  assert.equal(JSON.parse(status.content).contract.status, "active")
})

test("completion gate derives contract policy from taskKind", async () => {
  const state: any = createMemoryState()
  const lHarness = createToolHarness()
  await taskContractCapability.setup({
    ctx: lHarness.ctx,
    config: { documentation: { rules: [] }, versioning: { enabled: false, publicPaths: [] } } as any,
    state,
  })
  const clean = { revision: "rev-a", testsPassed: true, docsStatus: "clean", versionStatus: "not-applicable" }

  const trivial: any = await lHarness.tools
    .get("completion_gate")
    .execute(
      { taskKind: "docs-format", currentRevision: "rev-a", evidence: clean, requiredChecks: [] },
      { sessionID: "ses-1" },
    )
  assert.equal(JSON.parse(trivial.content).ok, true)

  const nonTrivial: any = await lHarness.tools
    .get("completion_gate")
    .execute(
      { taskKind: "feature", currentRevision: "rev-a", evidence: clean, requiredChecks: [] },
      { sessionID: "ses-1" },
    )
  const nonTrivialJson = JSON.parse(nonTrivial.content)
  assert.equal(nonTrivialJson.ok, false)
  assert.match(nonTrivialJson.reasons.join(" "), /Task Contract required/)
})

test("revision-sensitive requirement evidence is refused without a revision", () => {
  const contract = makeContract()
  for (const type of ["verification", "runtime", "diff"] as const) {
    const result = recordRequirementEvidence(contract, "REQ-1", {
      type,
      reference: "pointer",
    })
    assert.equal(result.ok, false)
  }

  assert.equal(
    recordRequirementEvidence(contract, "REQ-1", {
      type: "user-decision",
      reference: "user explicitly chose option A",
    }).ok,
    true,
  )
})

test("contract cannot close completed without an exact completion-gate seal", async () => {
  const state: any = createMemoryState()
  const { ctx, tools } = createToolHarness()
  await taskContractCapability.setup({ ctx, config: { models: {} } as any, state })
  const contract = tools.get("task_contract")

  await contract.execute(
    {
      op: "create",
      taskKind: "feature",
      goal: "ship feature",
      requirements: ["requirement"],
    },
    { sessionID: "ses-close" },
  )

  const denied: any = await contract.execute(
    { op: "close", outcome: "completed", revision: "rev-a" },
    { sessionID: "ses-close" },
  )
  assert.match(denied.content, /^refused:/)

  const statusBeforeClose: any = await contract.execute(
    { op: "status" },
    { sessionID: "ses-close" },
  )
  const currentContract = JSON.parse(statusBeforeClose.content).contract
  await state.set("task-contract-completion/ses-close", {
    revision: "rev-a",
    taskKind: "feature",
    contractStateToken: contractStateToken(currentContract),
    at: Date.now(),
  })
  const accepted: any = await contract.execute(
    { op: "close", outcome: "completed", revision: "rev-a" },
    { sessionID: "ses-close" },
  )
  assert.match(accepted.content, /"status": "completed"/)
})

test("completion gate denies a taskKind mismatch even when the requirement gate itself is green", async () => {
  const state: any = createMemoryState()
  const harness = createToolHarness()
  await taskContractCapability.setup({
    ctx: harness.ctx,
    config: { models: {} } as any,
    state,
  })

  const contract = harness.tools.get("task_contract")
  await contract.execute(
    {
      op: "create",
      taskKind: "docs-format",
      goal: "Format one document",
      requirements: ["format the document"],
    },
    { sessionID: "ses-kind-mismatch" },
  )
  await contract.execute(
    {
      op: "record_evidence",
      requirementId: "REQ-1",
      type: "user-decision",
      reference: "requested document formatting completed",
    },
    { sessionID: "ses-kind-mismatch" },
  )
  await contract.execute(
    { op: "update", requirementId: "REQ-1", status: "satisfied" },
    { sessionID: "ses-kind-mismatch" },
  )

  const lifecycle = createToolHarness()
  await taskContractCapability.setup({
    ctx: lifecycle.ctx,
    config: {
      documentation: { rules: [] },
      versioning: { enabled: false, publicPaths: [] },
    } as any,
    state,
  })

  const clean = {
    revision: "rev-a",
    testsPassed: true,
    docsStatus: "clean",
    versionStatus: "not-applicable",
  }
  const result: any = await lifecycle.tools.get("completion_gate").execute(
    {
      taskKind: "known-test",
      currentRevision: "rev-a",
      evidence: clean,
      requiredChecks: [],
    },
    { sessionID: "ses-kind-mismatch" },
  )

  const parsed = JSON.parse(result.content)
  assert.equal(parsed.ok, false)
  assert.match(parsed.reasons.join(" "), /taskKind mismatch/)
})

test("a completion seal for an older contract state cannot close a mutated contract", async () => {
  const state: any = createMemoryState()
  const { ctx, tools } = createToolHarness()
  await taskContractCapability.setup({
    ctx,
    config: { models: {} } as any,
    state,
  })

  const contract = tools.get("task_contract")
  await contract.execute(
    {
      op: "create",
      taskKind: "feature",
      goal: "Ship feature",
      requirements: ["ship the feature"],
    },
    { sessionID: "ses-stale-seal" },
  )

  const before: any = await contract.execute(
    { op: "status" },
    { sessionID: "ses-stale-seal" },
  )
  const beforeContract = JSON.parse(before.content).contract
  const staleToken = contractStateToken(beforeContract)

  await contract.execute(
    { op: "steer", addConstraints: ["do not change public API"] },
    { sessionID: "ses-stale-seal" },
  )

  // Simulate: gate evaluated A -> contract became B -> old gate writes A's seal.
  await state.set("task-contract-completion/ses-stale-seal", {
    revision: "rev-a",
    taskKind: "feature",
    contractStateToken: staleToken,
    at: Date.now(),
  })

  const close: any = await contract.execute(
    { op: "close", outcome: "completed", revision: "rev-a" },
    { sessionID: "ses-stale-seal" },
  )
  assert.match(close.content, /^refused:/)
  assert.match(close.content, /stale/)
})

test("completion gate ignores removed review state and closes on contract + verification only", async () => {
  const state: any = createMemoryState()
  const created = createTaskContract("ses-legacy-review-state", {
    taskKind: "security",
    goal: "harden auth",
    requirements: ["no bypass"],
  })
  assert.equal(created.ok, true)
  let contract = (created as { ok: true; contract: TaskContract }).contract
  contract = (
    recordRequirementEvidence(contract, "REQ-1", {
      type: "verification",
      reference: "security tests",
      revision: "rev-a",
    }) as { ok: true; contract: TaskContract }
  ).contract
  contract = (
    updateRequirementStatus(contract, "REQ-1", "satisfied") as { ok: true; contract: TaskContract }
  ).contract
  await state.set("task-contract/ses-legacy-review-state", contract)
  // Old stored review records are now unused data: they must not be read and
  // must never block or gate completion.
  await state.set("task-contract-review/ses-legacy-review-state/1", {
    verdict: "reject",
    findings: [],
    round: 1,
    reviewSessionID: "legacy-review",
    revision: "rev-a",
    at: 1,
  })
  await state.set("task-contract-review-availability/ses-legacy-review-state", {
    status: "unavailable",
    mode: "deep",
    reason: "deadline_exceeded",
    stage: "session.wait",
    revision: "rev-a",
    reviewSessionID: "legacy-review",
    elapsedMs: 180_000,
    contractStateToken: contractStateToken(contract),
    at: 1,
  })

  const harness = createToolHarness()
  await taskContractCapability.setup({
    ctx: harness.ctx,
    config: { documentation: { rules: [] }, versioning: { enabled: false, publicPaths: [] } } as any,
    state,
  })

  const result: any = await harness.tools.get("completion_gate").execute(
    {
      taskKind: "security",
      currentRevision: "rev-a",
      evidence: {
        revision: "rev-a",
        testsPassed: true,
        docsStatus: "clean",
        versionStatus: "not-applicable",
      },
      requiredChecks: [],
    },
    { sessionID: "ses-legacy-review-state" },
  )
  const parsed = JSON.parse(result.content)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.contractClosed, true)
  assert.equal("review" in parsed, false)
  assert.doesNotMatch(parsed.reasons.join(" "), /review/i)
})

test("contract creation supports 25 requirements with 1:1 REQ-N IDs", () => {
  const reqs = Array.from({ length: 25 }, (_, i) => `Real explicit obligation number ${i + 1}`)
  const result = createTaskContract("ses-25", {
    taskKind: "feature",
    goal: "Handle 25 requirements 1:1",
    requirements: reqs,
    constraints: ["no grouping"],
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.contract.requirements.length, 25)
    for (let i = 0; i < 25; i++) {
      assert.equal(result.contract.requirements[i].id, `REQ-${i + 1}`)
      assert.equal(result.contract.requirements[i].text, reqs[i])
      assert.equal(result.contract.requirements[i].status, "pending")
    }
  }
})

test("steering can increase total requirements beyond 20 up to 100", () => {
  const initialReqs = Array.from({ length: 18 }, (_, i) => `Initial requirement ${i + 1}`)
  const initial = createTaskContract("ses-steer", {
    taskKind: "feature",
    goal: "Initial contract",
    requirements: initialReqs,
    constraints: [],
  })
  assert.equal(initial.ok, true)
  if (!initial.ok) return

  const additionalReqs = Array.from({ length: 10 }, (_, i) => `Additional requirement ${i + 1}`)
  const steered = steerTaskContract(initial.contract, {
    addRequirements: additionalReqs,
  })
  assert.equal(steered.ok, true)
  if (steered.ok) {
    assert.equal(steered.contract.requirements.length, 28)
    assert.equal(steered.contract.requirements[27].id, "REQ-28")
  }
})

test("contract creation accepts up to 100 requirements", () => {
  const reqs = Array.from({ length: 100 }, (_, i) => `Requirement ${i + 1}`)
  const result = createTaskContract("ses-100", {
    taskKind: "feature",
    goal: "Handle 100 requirements",
    requirements: reqs,
    constraints: [],
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.contract.requirements.length, 100)
    assert.equal(result.contract.requirements[99].id, "REQ-100")
  }
})

test("contract creation rejects 101 requirements with explicit limit error", () => {
  const reqs = Array.from({ length: 101 }, (_, i) => `Requirement ${i + 1}`)
  const result = createTaskContract("ses-101", {
    taskKind: "feature",
    goal: "Exceed 100 requirements",
    requirements: reqs,
    constraints: [],
  })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.match(result.error, /100/)
    assert.match(result.error, /limited to 100/i)
  }
})

test("completion simplification: gate derives verification state and closes the Task Contract", async () => {
  const state: any = createMemoryState()
  const contractHarness = createToolHarness()
  await taskContractCapability.setup({ ctx: contractHarness.ctx, config: { models: {} } as any, state })
  const contractTool = contractHarness.tools.get("task_contract")
  await contractTool.execute(
    { taskKind: "feature", op: "create", goal: "Ship bounded feature", requirements: ["feature works"] },
    { sessionID: "ses-simple-complete" },
  )
  await contractTool.execute(
    { op: "record_evidence", requirementId: "REQ-1", type: "verification", reference: "tests", revision: "rev-a" },
    { sessionID: "ses-simple-complete" },
  )
  await contractTool.execute(
    { op: "update", requirementId: "REQ-1", status: "satisfied" },
    { sessionID: "ses-simple-complete" },
  )

  await state.set("verification/rev-a/tests", {
    revision: "rev-a", check: "tests", passed: true, at: 1, executionId: "exec-tests",
  })
  await state.set("verification/rev-a/typecheck", {
    revision: "rev-a", check: "typecheck", passed: true, at: 2, executionId: "exec-type",
  })
  await state.set("verification-evidence/exec-tests", {
    executionId: "exec-tests", status: "completed", revision: "rev-a",
  })
  await state.set("verification-evidence/exec-type", {
    executionId: "exec-type", status: "completed", revision: "rev-a",
  })
  const lifecycleHarness = createToolHarness()
  await taskContractCapability.setup({
    ctx: lifecycleHarness.ctx,
    config: { documentation: { rules: [] }, versioning: { enabled: false, publicPaths: [] } } as any,
    state,
  })
  const gate = lifecycleHarness.tools.get("completion_gate")
  assert.equal(gate.input.required.includes("evidence"), false)

  const result: any = await gate.execute(
    {
      taskKind: "feature",
      currentRevision: "rev-a",
      docsStatus: "clean",
      versionStatus: "not-applicable",
      requiredChecks: ["tests", "typecheck"],
    },
    { sessionID: "ses-simple-complete" },
  )
  const parsed = JSON.parse(result.content)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.contractClosed, true)

  const status: any = await contractTool.execute({ op: "status" }, { sessionID: "ses-simple-complete" })
  assert.equal(JSON.parse(status.content).contract.status, "completed")
  assert.equal(await state.get("task-contract-completion/ses-simple-complete"), undefined)

  const legacyClose: any = await contractTool.execute(
    { op: "close", outcome: "completed", revision: "rev-a" },
    { sessionID: "ses-simple-complete" },
  )
  assert.equal(JSON.parse(legacyClose.content).alreadyCompleted, true)
})

test("completion simplification: a denied gate leaves the Task Contract active", async () => {
  const state: any = createMemoryState()
  const contractHarness = createToolHarness()
  await taskContractCapability.setup({ ctx: contractHarness.ctx, config: { models: {} } as any, state })
  const contractTool = contractHarness.tools.get("task_contract")
  await contractTool.execute(
    { taskKind: "feature", op: "create", goal: "Ship bounded feature", requirements: ["still pending"] },
    { sessionID: "ses-simple-denied" },
  )

  const lifecycleHarness = createToolHarness()
  await taskContractCapability.setup({
    ctx: lifecycleHarness.ctx,
    config: { documentation: { rules: [] }, versioning: { enabled: false, publicPaths: [] } } as any,
    state,
  })
  const result: any = await lifecycleHarness.tools.get("completion_gate").execute(
    {
      taskKind: "feature",
      currentRevision: "rev-a",
      docsStatus: "clean",
      versionStatus: "not-applicable",
      requiredChecks: [],
    },
    { sessionID: "ses-simple-denied" },
  )
  const parsed = JSON.parse(result.content)
  assert.equal(parsed.ok, false)
  assert.equal(parsed.contractClosed, false)

  const status: any = await contractTool.execute({ op: "status" }, { sessionID: "ses-simple-denied" })
  assert.equal(JSON.parse(status.content).contract.status, "active")
})
