import test from "node:test"
import assert from "node:assert/strict"
import { verificationCapability } from "../src/capabilities/verification/index.ts"
import { lifecycleCapability } from "../src/capabilities/lifecycle/index.ts"

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
  await lifecycleCapability.setup({ ctx: lHarness.ctx, config: { documentation: { rules: [] }, versioning: { enabled: false, publicPaths: [] } } as any, state })
  const gate = lHarness.tools.get("completion_gate")
  assert.ok(gate)

  const clean = {
    revision: "rev-a",
    testsPassed: true,
    docsStatus: "clean",
    versionStatus: "not-applicable",
  }

  // Only tests recorded: typecheck missing, so the gate must fail despite testsPassed:true.
  const blocked: any = await gate.execute({ currentRevision: "rev-a", evidence: clean })
  const blockedJson = JSON.parse(blocked.content)
  assert.equal(blockedJson.ok, false)
  assert.match(blockedJson.reasons.join(" "), /required verification/)

  // After recording the second check, the same revision becomes formally verified.
  await vTools.get("record_receipt").execute(
    { revision: "rev-a", check: "typecheck", passed: true, command: "bunx tsc --noEmit" },
    { sessionID: "ses-1" },
  )
  const passed: any = await gate.execute({ currentRevision: "rev-a", evidence: clean })
  assert.equal(JSON.parse(passed.content).ok, true)

  // Explicit opt-out for tasks that genuinely require no checks.
  const trivial: any = await gate.execute({ currentRevision: "rev-a", evidence: clean, requiredChecks: [] })
  assert.equal(JSON.parse(trivial.content).ok, true)
})
