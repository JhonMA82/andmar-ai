import test from "node:test"
import assert from "node:assert/strict"
import { verificationCapability } from "../src/capabilities/verification/index.ts"
import { taskContractCapability } from "../src/capabilities/task-contract/index.ts"

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
    _map: map,
  }
}

function createToolHarness() {
  const tools = new Map<string, any>()
  let afterHandler: ((event: any) => Promise<void>) | undefined
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
      async hook(name: string, handler: (event: any) => Promise<void>) {
        if (name === "execute.after") afterHandler = handler
        return { dispose() {} }
      },
    },
  }
  return { ctx, tools, getAfterHandler: () => afterHandler }
}

test("full flow: execute.after -> record_receipt (no executionId) -> verify_revision -> completion gate", async () => {
  const state: any = createMemoryState()
  const { ctx, tools, getAfterHandler } = createToolHarness()
  await verificationCapability.setup({ ctx, config: {} as any, state })

  const record = tools.get("record_receipt")
  assert.ok(record)
  // Agent contract requires command and forbids executionId.
  assert.deepEqual([...record.input.required].sort(), ["check", "command", "passed", "revision"])
  assert.equal("executionId" in record.input.properties, false)

  const verify = tools.get("verify_revision")
  assert.ok(verify)

  const after = getAfterHandler()
  assert.ok(after)

  // Two real executions observed in the same session.
  await after!({
    id: "exec-tests",
    tool: "bash",
    sessionID: "ses-1",
    status: "completed",
    input: { command: "bun test" },
    result: { output: "ok" },
  })
  await after!({
    id: "exec-type",
    tool: "bash",
    sessionID: "ses-1",
    status: "completed",
    input: { command: "bunx tsc --noEmit" },
    result: { output: "ok" },
  })

  // Record without any executionId supplied by the agent.
  const first: any = await record.execute(
    { revision: "rev-a", check: "tests", passed: true, command: "bun test" },
    { sessionID: "ses-1" },
  )
  assert.match(first.content, /"stored": true/)
  assert.match(first.content, /exec-tests/)

  const second: any = await record.execute(
    { revision: "rev-a", check: "typecheck", passed: true, command: "bunx tsc --noEmit" },
    { sessionID: "ses-1" },
  )
  assert.match(second.content, /"stored": true/)

  const verified: any = await verify.execute({ currentRevision: "rev-a" })
  const summary = JSON.parse(verified.content)
  assert.equal(summary.ok, true)
  assert.deepEqual(summary.missing, [])
  assert.deepEqual(summary.unverified, [])
})

test("tool-level rejections: nonexistent, failed-as-passing, other session, different command", async () => {
  const state: any = createMemoryState()
  const { ctx, tools, getAfterHandler } = createToolHarness()
  await verificationCapability.setup({ ctx, config: {} as any, state })
  const record = tools.get("record_receipt")
  const after = getAfterHandler()!

  await after({
    id: "exec-1",
    tool: "bash",
    sessionID: "ses-1",
    status: "completed",
    input: { command: "bun test" },
    result: {},
  })
  await after({
    id: "exec-fail",
    tool: "bash",
    sessionID: "ses-1",
    status: "error",
    input: { command: "bun run failing-check" },
    error: { message: "boom" },
  })

  const nonexistent: any = await record.execute(
    { revision: "rev-a", check: "lint", passed: true, command: "bun lint" },
    { sessionID: "ses-1" },
  )
  assert.match(nonexistent.content, /^refused:/)

  const failedAsPassing: any = await record.execute(
    { revision: "rev-a", check: "tests", passed: true, command: "bun run failing-check" },
    { sessionID: "ses-1" },
  )
  assert.match(failedAsPassing.content, /failed execution|cannot become|did not complete/)

  const otherSession: any = await record.execute(
    { revision: "rev-a", check: "tests", passed: true, command: "bun test" },
    { sessionID: "ses-other" },
  )
  assert.match(otherSession.content, /another session|current session|no observed/)

  const differentCommand: any = await record.execute(
    { revision: "rev-a", check: "tests", passed: true, command: "bunx tsc --noEmit" },
    { sessionID: "ses-1" },
  )
  assert.match(differentCommand.content, /command mismatch|no observed/)
})

test("completion_gate tool enforces stored verification and stays proportional", async () => {
  const state: any = createMemoryState()
  const vHarness = createToolHarness()
  await verificationCapability.setup({ ctx: vHarness.ctx, config: {} as any, state })
  const vTools = vHarness.tools
  const after = vHarness.getAfterHandler()!

  await after({
    id: "exec-tests",
    tool: "bash",
    sessionID: "ses-1",
    status: "completed",
    input: { command: "bun test" },
    result: {},
  })
  await after({
    id: "exec-type",
    tool: "bash",
    sessionID: "ses-1",
    status: "completed",
    input: { command: "bunx tsc --noEmit" },
    result: {},
  })
  await vTools.get("record_receipt").execute(
    { revision: "rev-a", check: "tests", passed: true, command: "bun test" },
    { sessionID: "ses-1" },
  )

  const lHarness = createToolHarness()
  await taskContractCapability.setup({ ctx: lHarness.ctx, config: { documentation: { rules: [] }, versioning: { enabled: false, publicPaths: [] } } as any, state })
  const gate = lHarness.tools.get("completion_gate")
  assert.ok(gate)

  const clean = {
    docsStatus: "clean" as const,
    versionStatus: "not-applicable" as const,
  }

  // Only tests recorded: typecheck missing, so the default required checks fail.
  const blocked: any = await gate.execute(
    { taskKind: "known-test", currentRevision: "rev-a", ...clean },
    { sessionID: "ses-1" },
  )
  const blockedJson = JSON.parse(blocked.content)
  assert.equal(blockedJson.ok, false)
  assert.match(blockedJson.reasons.join(" "), /required verification/)
  assert.match(blockedJson.reasons.join(" "), /missing receipts/)

  // After recording the second check, the same revision becomes formally verified.
  await vTools.get("record_receipt").execute(
    { revision: "rev-a", check: "typecheck", passed: true, command: "bunx tsc --noEmit" },
    { sessionID: "ses-1" },
  )
  const passed: any = await gate.execute(
    { taskKind: "known-test", currentRevision: "rev-a", ...clean },
    { sessionID: "ses-1" },
  )
  assert.equal(JSON.parse(passed.content).ok, true)

  // Explicit opt-out for tasks that genuinely require no checks.
  const trivial: any = await gate.execute(
    { taskKind: "known-test", currentRevision: "rev-a", ...clean, requiredChecks: [] },
    { sessionID: "ses-1" },
  )
  assert.equal(JSON.parse(trivial.content).ok, true)
})

test("record_receipt emits structured rejection metadata without command/reason content", async () => {
  const state: any = createMemoryState()
  const { ctx, tools, getAfterHandler } = createToolHarness()
  const emitted: any[] = []
  await verificationCapability.setup({
    ctx,
    config: {} as any,
    state,
    observability: { emit(event: any) { emitted.push(event) } },
  })

  const after = getAfterHandler()!
  await after({
    id: "exec-failed",
    tool: "bash",
    sessionID: "ses-1",
    status: "error",
    input: { command: "bun test" },
    error: { message: "boom" },
  })

  const result: any = await tools.get("record_receipt").execute(
    { revision: "rev-a", check: "tests", passed: true, command: "bun test" },
    { sessionID: "ses-1" },
  )

  assert.match(result.content, /^refused:/)
  const event = emitted.at(-1)
  assert.equal(event.type, "andmar.verification")
  assert.equal(event.sessionID, "ses-1")
  assert.deepEqual(event.payload, {
    action: "receipt_rejected",
    category: "failed-execution",
    check: "tests",
    claimedPassed: true,
    stored: false,
  })
  assert.equal("command" in event.payload, false)
  assert.equal("reason" in event.payload, false)
})


test("a shell command that exits non-zero cannot become a passed receipt", async () => {
  const state: any = createMemoryState()
  const { ctx, tools, getAfterHandler } = createToolHarness()
  const emitted: any[] = []
  await verificationCapability.setup({
    ctx,
    config: {} as any,
    state,
    observability: { emit(event: any) { emitted.push(event) } },
  })

  // OpenCode reports a non-zero process exit as a *completed* tool call whose
  // result carries `metadata.exit`.
  const after = getAfterHandler()!
  await after({
    id: "exec-nonzero",
    tool: "shell",
    sessionID: "ses-1",
    status: "completed",
    input: { command: "bun test" },
    result: { output: "1..0\n# fail 1", metadata: { output: "1..0", truncated: true, exit: 1 } },
  })

  const result: any = await tools.get("record_receipt").execute(
    { revision: "rev-a", check: "tests", passed: true, command: "bun test" },
    { sessionID: "ses-1" },
  )
  assert.match(result.content, /^refused:/)
  assert.match(result.content, /non-zero exit/)
  assert.deepEqual(emitted.at(-1).payload, {
    action: "receipt_rejected",
    category: "failed-execution",
    check: "tests",
    claimedPassed: true,
    stored: false,
  })

  // The same execution may still be recorded honestly as a failed receipt.
  const honest: any = await tools.get("record_receipt").execute(
    { revision: "rev-a", check: "tests", passed: false, command: "bun test" },
    { sessionID: "ses-1" },
  )
  assert.equal(JSON.parse(honest.content).stored, true)
  assert.equal(JSON.parse(honest.content).receipt.passed, false)

  // AndMar's own summary must agree: the revision cannot be verified as green.
  const verify: any = await tools.get("verify_revision").execute(
    { currentRevision: "rev-a", requiredChecks: ["tests"] },
    { sessionID: "ses-1" },
  )
  const summary = JSON.parse(verify.content)
  assert.equal(summary.ok, false)
  assert.deepEqual(summary.failed, ["tests"])
  assert.match(summary.reasons.join(" "), /failed checks/)
})

test("shared Code Mode IDs retain independent evidence across parallel children and restart", async () => {
  const state: any = createMemoryState()
  const first = createToolHarness()
  const dispose = await verificationCapability.setup({ ctx: first.ctx, config: {} as any, state })
  const after = first.getAfterHandler()!
  const event = (command: string, status = "completed") => ({
    id: "shared-frame", tool: "shell", sessionID: "ses-1", status,
    input: { command }, result: { output: "ok" }, error: { message: "failed" },
  })
  await Promise.all([after(event("bun test")), after(event("bun run typecheck"))])
  await after({ id: "shared-frame", tool: "execute", sessionID: "ses-1", status: "completed", input: { code: "children" } })
  const record = first.tools.get("record_receipt")
  for (const [command, check] of [["bun test", "tests"], ["bun run typecheck", "typecheck"]]) {
    assert.equal(JSON.parse((await record.execute({ revision: "rev-a", check, command, passed: true }, { sessionID: "ses-1" })).content).stored, true)
  }
  const original = await state.scan("verification-evidence/")
  assert.equal(original.length, 2)
  assert.equal(new Set(original.map((e: any) => e.value.executionId)).size, 2)
  await dispose?.()
  const restarted = createToolHarness()
  await verificationCapability.setup({ ctx: restarted.ctx, config: {} as any, state })
  await restarted.getAfterHandler()!(event("bun test", "error"))
  const refused = await restarted.tools.get("record_receipt").execute({ revision: "rev-a", check: "tests", command: "bun test", passed: true }, { sessionID: "ses-1" })
  assert.match(refused.content, /^refused:.*did not complete/)
  const retained = await state.scan("verification-evidence/")
  assert.equal(retained.length, 3)
  for (const entry of original) assert.deepEqual(await state.get(entry.key), entry.value)
  await restarted.getAfterHandler()!(event("bun test"))
  const fresh = await restarted.tools.get("record_receipt").execute({ revision: "rev-b", check: "tests", command: "bun test", passed: true }, { sessionID: "ses-1" })
  assert.equal(JSON.parse(fresh.content).stored, true)
  assert.equal((await state.scan("verification-evidence/")).length, 4)
})
