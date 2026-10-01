import test from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { classifyDiscovery, normalizeFiles, runWorkUnitLifecycle, scopeDrift } from "../scripts/work-ledger-lifecycle.mjs"
import { checkpointResponseAfter, editedFiles, projectWork, setupWorkTracking } from "../src/capabilities/lifecycle/work.ts"
import { decisionDeterministic, isTrivialBypass } from "../src/capabilities/intake/decide.ts"
import { verificationCapability } from "../src/capabilities/verification/index.ts"
import { taskContractCapability } from "../src/capabilities/task-contract/index.ts"
import { createSemanticObservability } from "../src/core/observability.ts"

const routine = { title: "Add necessary test", reason: "Discovered missing coverage for REQ-1", risk: "low", withinGoal: true, materialScope: false, humanDecision: false, hardToReverse: false, contradictsContract: false, changesObligation: false, expectedFiles: ["tests/**"] } as const

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "andmar-tracking-"))
  const dir = join(root, ".andmar/work/task")
  await mkdir(dir, { recursive: true })
  await mkdir(join(root, "src"))
  await mkdir(join(root, "tests"))
  await writeFile(join(dir, "WORK.md"), `# Work — Task
Work ID: task
Status: active
Mode: lightweight

## Requirements
- REQ-1: Implement and test the requested change

## Work Units
- [~] WU-1 — Implement
  - Requirements: REQ-1
  - Expected Files: ["src/**"]
- [ ] WU-2 — Verify
  - Requirements: REQ-1

## Evidence
- EV-1: focused test passed
- EV-2: integrated verification passed

## Next
WU-1 — Implement
`)
  return { root, dir }
}

function mock(root: string, rpcFailure = false) {
  const hooks: Record<string, (event: any) => Promise<void>> = {}
  const tools: Record<string, any> = {}
  const notifications: any[] = []
  let messages = [{ id: "u1", type: "user", text: "Original task", time: { created: 0 } }]
  let vcsPaths: string[] = []
  let vcsCalls = 0
  let rpcHandlers: any
  let disposals = 0
  const ctx = {
    location: { directory: root },
    tool: {
      transform: async (fn: any) => { fn({ add: (tool: any) => { tools[tool.name] = tool } }); return { dispose: () => disposals++ } },
      hook: async (name: string, fn: any) => { hooks[name] = fn; return { dispose: () => disposals++ } },
    },
    session: { context: async () => messages },
    vcs: { status: async () => { vcsCalls++; return { data: vcsPaths.map((file) => ({ file, status: "modified" })) } } },
    rpc: { register: async (_definition: any, handlers: any) => {
      if (rpcFailure) throw new Error("RPC unavailable")
      rpcHandlers = handlers
      return { events: { emit: async (_name: string, event: any) => notifications.push(event) }, dispose: () => disposals++ }
    } },
  }
  return { ctx, hooks, tools, notifications, user: (id: string, created = Date.now() + 100) => { messages = [...messages, { id, type: "user", text: "Resolve checkpoint", time: { created } }] }, paths: (paths: string[]) => { vcsPaths = paths }, vcsCalls: () => vcsCalls, rpc: () => rpcHandlers, disposals: () => disposals }
}

const context = { sessionID: "s" }
const event = (tool: string, id: string, extra = {}) => ({ tool, id, sessionID: "s", agent: "andmar", messageID: "m", ...extra })
const content = (output: any) => JSON.parse(output.content)

async function setup(m: ReturnType<typeof mock>) {
  return setupWorkTracking({ ctx: m.ctx, config: {} as any, state: {} as any })
}

test("structured successful-edit paths deduplicate and never parse prose", () => {
  assert.deepEqual(editedFiles({ resource: "a", files: [{ file: "a" }, { file: "b" }], applied: [{ resource: "c" }] }), ["a", "b", "c"])
  assert.deepEqual(editedFiles("Changed src/a.ts"), [])
  assert.deepEqual(editedFiles({ content: "Changed src/a.ts" }), [])
})

test("scope: files, directories/globs, related discoveries and unknown scope", () => {
  assert.deepEqual(scopeDrift(["src/a.ts"], ["src/a.ts"]), [])
  assert.deepEqual(scopeDrift(["src/a.ts", "src/nested/b.ts"], ["src/**"]), [])
  assert.deepEqual(scopeDrift(["src/a.ts"], ["src/*.ts"]), [])
  assert.deepEqual(scopeDrift(["src/a.ts", "src/nested/b.ts"], ["src/**/*.ts"]), [])
  assert.deepEqual(scopeDrift(["root.ts"], ["**/*.ts"]), [])
  assert.deepEqual(scopeDrift(["src/a.ts", "tests/a.test.ts"], ["src/**"]), ["tests/a.test.ts"])
  assert.deepEqual(scopeDrift(["src/a.ts"], []), [])
})

test("paths: outside workspace, traversal, Windows and symlink escapes rejected", async () => {
  const { root } = await fixture()
  const other = await mkdtemp(join(tmpdir(), "andmar-outside-"))
  try {
    assert.throws(() => normalizeFiles(["../outside.ts"], root), /Outside workspace/)
    assert.throws(() => normalizeFiles(["C:\\outside.ts"], root), /Outside workspace/)
    assert.throws(() => normalizeFiles([join(other, "a")], root), /Outside workspace/)
    await symlink(other, join(root, "escape"))
    assert.throws(() => normalizeFiles(["escape/new.ts"], root), /Outside workspace/)
    assert.deepEqual(normalizeFiles(["src/a.ts", join(root, "src/a.ts")], root), ["src/a.ts"])
  } finally { await rm(root, { recursive: true, force: true }); await rm(other, { recursive: true, force: true }) }
})

for (const [flag, value] of [["materialScope", true], ["humanDecision", true], ["risk", "high"], ["hardToReverse", true], ["contradictsContract", true], ["changesObligation", true], ["withinGoal", false]] as const) {
  test(`discovery: ${flag} causes durable checkpoint; no further lifecycle execution`, async () => {
    const { root, dir } = await fixture()
    try {
      const result = await runWorkUnitLifecycle("amend", dir, undefined, { discovery: { ...routine, expectedFiles: [], [flag]: value } })
      assert.equal(result.checkpointRequired, true)
      const status = await runWorkUnitLifecycle("status", dir)
      assert.equal(status.status, "blocked")
      assert.equal(status.units?.length, 3)
      await assert.rejects(() => runWorkUnitLifecycle("activate", dir, "WU-2"), /Work is blocked/)
      await assert.rejects(() => runWorkUnitLifecycle("amend", dir, undefined, { discovery: { ...routine, expectedFiles: [] } }), /Work is blocked/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}

test("discovery: invalid facts cannot invent states, requirements or Markdown", () => {
  assert.throws(() => classifyDiscovery({ ...routine, withinGoal: undefined } as any), /withinGoal/)
  assert.throws(() => classifyDiscovery({ ...routine, risk: "safe" } as any), /risk/)
  assert.throws(() => classifyDiscovery({ ...routine, title: "hello\nStatus: completed" } as any), /title/)
})

test("routine append + continue preserves requirements and completes without a checkpoint", async () => {
  const { root, dir } = await fixture()
  try {
    await runWorkUnitLifecycle("complete", dir, "WU-1", { evidence: "EV-1" })
    assert.equal((await runWorkUnitLifecycle("amend", dir, undefined, { discovery: { ...routine, expectedFiles: [...routine.expectedFiles] } })).continue, true)
    await runWorkUnitLifecycle("touch", dir, "WU-2", { files: ["src/a.ts", "src/a.ts", "tests/new.test.ts"] })
    const status = await runWorkUnitLifecycle("status", dir)
    assert.deepEqual(status.units?.[1]?.touchedFiles, ["src/a.ts", "tests/new.test.ts"])
    assert.deepEqual(status.units?.[2]?.expectedFiles, ["tests/**"])
    await runWorkUnitLifecycle("complete", dir, "WU-2", { evidence: "EV-2" })
    await runWorkUnitLifecycle("complete", dir, "WU-3", { evidence: "EV-2" })
    assert.equal((await runWorkUnitLifecycle("status", dir)).completionReady, true)
    await assert.rejects(() => runWorkUnitLifecycle("complete", dir, "WU-3", { evidence: "EV-2" }), /requires active/)
    await runWorkUnitLifecycle("finalize", dir, undefined, { revision: "accepted-revision" })
    assert.equal((await runWorkUnitLifecycle("status", dir)).status, "completed")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("parallel native helper and hook writes preserve both changes", async () => {
  const { root, dir } = await fixture()
  try {
    await Promise.all([
      runWorkUnitLifecycle("touch", dir, "WU-1", { files: ["src/a.ts"] }),
      runWorkUnitLifecycle("touch", dir, "WU-1", { files: ["src/b.ts"] }),
      runWorkUnitLifecycle("amend", dir, undefined, { discovery: { ...routine, expectedFiles: [] } }),
    ])
    const status = await runWorkUnitLifecycle("status", dir)
    assert.deepEqual(status.units?.[0]?.touchedFiles, ["src/a.ts", "src/b.ts"])
    assert.equal(status.units?.length, 3)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("hook attribution survives advancement, deduplicates and reports drift without pausing", async () => {
  const { root, dir } = await fixture()
  const m = mock(root)
  const dispose = await setup(m)
  try {
    await m.tools.work_status.execute({ workId: "task" }, context)
    await m.hooks["execute.before"]!(event("patch", "p"))
    await runWorkUnitLifecycle("complete", dir, "WU-1", { evidence: "EV-1" })
    await m.hooks["execute.after"]!(event("patch", "p", { status: "completed", result: { output: { files: [{ file: "src/a.ts" }, { file: "tests/new.test.ts" }, { file: "src/a.ts" }] } } }))
    const ledger = await runWorkUnitLifecycle("status", dir)
    assert.deepEqual(ledger.units?.[0]?.touchedFiles, ["src/a.ts", "tests/new.test.ts"])
    assert.deepEqual(ledger.units?.[0]?.drift, ["tests/new.test.ts"])
    assert.deepEqual(ledger.units?.[1]?.touchedFiles, [])
    assert.equal(ledger.checkpointRequired, false)
    assert(m.notifications.some((entry) => entry.reason === "work.drift"))
  } finally { dispose(); await rm(root, { recursive: true, force: true }) }
})

test("failed edit creates no claimed touches; unsupported/outside edit output is visible", async () => {
  const { root, dir } = await fixture()
  const m = mock(root)
  const dispose = await setup(m)
  try {
    await m.tools.work_status.execute({ workId: "task" }, context)
    await m.hooks["execute.before"]!(event("edit", "fail"))
    await m.hooks["execute.after"]!(event("edit", "fail", { status: "error" }))
    assert.deepEqual((await runWorkUnitLifecycle("status", dir)).units?.[0]?.touchedFiles, [])
    await m.hooks["execute.before"]!(event("edit", "outside"))
    await m.hooks["execute.after"]!(event("edit", "outside", { status: "completed", result: { output: { resource: "../escape.ts" } } }))
    assert.match(content(await m.tools.work_status.execute({}, context)).trackingError, /Outside workspace/)
    await m.hooks["execute.before"]!(event("edit", "unsupported"))
    await m.hooks["execute.after"]!(event("edit", "unsupported", { status: "completed", result: { content: "Changed src/a.ts" } }))
    assert.match(content(await m.tools.work_status.execute({}, context)).trackingError, /no structured/)
  } finally { dispose(); await rm(root, { recursive: true, force: true }) }
})

test("shell tracking uses native VCS and hashes: dirty modifications, new/deleted files, no-ops and partial errors", async () => {
  const { root, dir } = await fixture()
  const m = mock(root)
  const dispose = await setup(m)
  try {
    await m.tools.work_status.execute({ workId: "task" }, context)
    await writeFile(join(root, "src/existing.ts"), "before")
    m.paths(["src/existing.ts"])
    await m.hooks["execute.before"]!(event("shell", "shell-1"))
    await writeFile(join(root, "src/existing.ts"), "after!") // same bytes, already dirty
    await writeFile(join(root, "src/new.ts"), "new")
    m.paths(["src/existing.ts", "src/new.ts"])
    await m.hooks["execute.after"]!(event("shell", "shell-1", { status: "completed", result: { content: "no path parsing" } }))
    assert.deepEqual((await runWorkUnitLifecycle("status", dir)).units?.[0]?.touchedFiles, ["src/existing.ts", "src/new.ts"])
    const before = await readFile(join(dir, "WORK.md"), "utf8")
    await m.hooks["execute.before"]!(event("bash", "noop"))
    await m.hooks["execute.after"]!(event("bash", "noop", { status: "completed" }))
    assert.equal(await readFile(join(dir, "WORK.md"), "utf8"), before)
    await writeFile(join(root, "src/delete.ts"), "old")
    m.paths(["src/existing.ts", "src/new.ts", "src/delete.ts"])
    await m.hooks["execute.before"]!(event("shell", "partial"))
    await rm(join(root, "src/delete.ts"))
    await m.hooks["execute.after"]!(event("shell", "partial", { status: "error" }))
    assert((await runWorkUnitLifecycle("status", dir)).units?.[0]?.touchedFiles.includes("src/delete.ts"))
  } finally { dispose(); await rm(root, { recursive: true, force: true }) }
})

test("runtime loss: Ledger alone reconstructs projection; RPC/TUI failure does not affect work", async () => {
  const { root, dir } = await fixture()
  const first = mock(root)
  const dispose = await setup(first)
  try {
    await first.tools.work_status.execute({ workId: "task" }, context)
    await runWorkUnitLifecycle("touch", dir, "WU-1", { files: ["src/a.ts"] })
    const before = await first.rpc().get({ sessionID: "s" })
    dispose()
    const next = mock(root, true)
    const cleanup = await setup(next)
    try {
      assert.equal(content(await next.tools.work_status.execute({}, context)), null)
      const restored = content(await next.tools.work_status.execute({ workId: "task" }, context))
      assert.deepEqual(restored, before)
      assert.equal(restored.activeWorkUnit, "WU-1")
      assert.deepEqual(restored.touchedFiles, ["src/a.ts"])
    } finally { cleanup() }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("exception pauses native execution until user response + explicit resume, including restart", async () => {
  const { root } = await fixture()
  const m = mock(root)
  const dispose = await setup(m)
  try {
    await m.tools.work_status.execute({ workId: "task" }, context)
    const amendment = content(await m.tools.work_amend.execute({ ...routine, materialScope: true }, context))
    assert.equal(amendment.checkpointRequired, true)
    for (const tool of ["shell", "edit", "write", "patch", "andmar_delegate", "andmar_completion_gate"]) {
      await assert.rejects(() => m.hooks["execute.before"]!(event(tool, tool)), /execution paused/)
    }
    await m.hooks["execute.before"]!(event("read", "read"))
    assert.match((await m.tools.work_resume.execute({ reason: "approved" }, context)).content, /waiting for/)
    await m.hooks["execute.before"]!(event("andmar.work_resume", "native-resume"))
    await assert.rejects(() => m.hooks["execute.before"]!(event("andmar/work_amend", "native-amend")), /execution paused/)
    m.user("u2")
    const resumed = content(await m.tools.work_resume.execute({ reason: "User approved the additional scope" }, context))
    assert.equal(resumed.status, "active")
    await m.hooks["execute.before"]!(event("edit", "now-allowed"))
  } finally { dispose(); await rm(root, { recursive: true, force: true }) }
})

test("checkpoint gate accepts bare OpenCode recovery names and keeps product execution paused", async () => {
  const { root } = await fixture()
  const m = mock(root)
  const dispose = await setup(m)
  try {
    await m.tools.work_status.execute({ workId: "task" }, context)
    const amendment = content(await m.tools.work_amend.execute({ ...routine, humanDecision: true }, context))
    assert.equal(amendment.checkpointRequired, true)

    // OpenCode 2.0.20 can surface registered tools to execute.before by
    // their local names rather than the namespaced UI label.
    for (const tool of ["work_status", "status", "intake", "route", "task_contract", "work_resume"]) {
      await m.hooks["execute.before"]!(event(tool, `allowed-${tool}`))
    }
    for (const tool of ["andmar.work_resume", "andmar/work_resume", "andmar_work_resume"]) {
      await m.hooks["execute.before"]!(event(tool, `allowed-${tool}`))
    }

    for (const tool of ["read", "search", "grep", "glob", "list", "question"]) {
      const id = `read-${tool}`
      await m.hooks["execute.before"]!(event(tool, id))
      await m.hooks["execute.after"]!(event(tool, id, { status: "completed" }))
    }

    const statusWhileBlocked = content(await m.tools.work_status.execute({}, context))
    assert.equal(statusWhileBlocked.checkpointRequired, true)
    assert.equal(statusWhileBlocked.status, "blocked")

    for (const tool of ["shell", "edit", "write", "patch", "work_amend", "completion_gate", "andmar/work_amend"]) {
      await assert.rejects(() => m.hooks["execute.before"]!(event(tool, `blocked-${tool}`)), /execution paused/)
    }

    assert.match((await m.tools.work_resume.execute({ reason: "pretend response" }, context)).content, /waiting for/)
    m.user("u2")
    await m.hooks["execute.before"]!(event("work_resume", "bare-resume-after-user"))
    const resumed = content(await m.tools.work_resume.execute({ reason: "User resolved the checkpoint" }, context))
    assert.equal(resumed.status, "active")
    await m.hooks["execute.before"]!(event("edit", "edit-after-resume"))
  } finally { dispose(); await rm(root, { recursive: true, force: true }) }
})

test("trivial request retains Intake bypass and unbound tracking fast path: no IO, VCS or checkpoints", async () => {
  const request = "Cambia el texto del botón Login por Entrar"
  assert.equal(isTrivialBypass(request), true)
  const decision = decisionDeterministic(request)
  assert.equal(decision.mode, "direct")
  assert.equal(decision.workProjection.mode, "none")
  const m = mock("/nonexistent/no-ledger")
  const dispose = await setup(m)
  try {
    await m.hooks["execute.before"]!(event("edit", "trivial"))
    await m.hooks["execute.after"]!(event("edit", "trivial", { status: "completed", result: { output: { resource: "button.tsx" } } }))
    assert.equal(m.vcsCalls(), 0)
    assert.equal(m.notifications.length, 0)
    assert.equal(await m.rpc().get({ sessionID: "s" }), null)
  } finally { dispose() }
})

test("verification projection reuses existing semantic events and retains no tool output", async () => {
  const { root } = await fixture()
  const m = mock(root)
  const previous = process.env.ANDMAR_OBSERVABILITY_ENABLED
  process.env.ANDMAR_OBSERVABILITY_ENABLED = "0"
  const observability = createSemanticObservability({ directory: root })
  const dispose = await setupWorkTracking({ ctx: m.ctx, config: {} as any, state: {} as any, observability })
  try {
    await m.tools.work_status.execute({ workId: "task" }, context)
    observability.emit({ type: "andmar.verification", sessionID: "s", payload: { action: "verify_revision", revision: "r", ok: true, output: "MUST NOT STORE" } })
    const projection = await m.rpc().get({ sessionID: "s" })
    assert.deepEqual(projection.lastVerification, { action: "verify_revision", revision: "r", ok: true })
    assert(!JSON.stringify(projection).includes("MUST NOT STORE"))
  } finally {
    dispose()
    if (previous === undefined) delete process.env.ANDMAR_OBSERVABILITY_ENABLED
    else process.env.ANDMAR_OBSERVABILITY_ENABLED = previous
    await rm(root, { recursive: true, force: true })
  }
})


test("representative flow: Intake, durable Ledger, Task Contract, amendment, touches, Verification, Completion", async () => {
  const request = "Agrega validación al formulario y pruebas, conserva la API existente"
  const decision = decisionDeterministic(request)
  assert.notEqual(decision.workProjection.mode, "none")
  const { root, dir } = await fixture()
  const m = mock(root)
  const cleanup = await setup(m)
  const map = new Map<string, unknown>()
  const state = {
    get: async <T>(key: string) => map.get(key) as T | undefined,
    set: async <T>(key: string, value: T) => { map.set(key, value) },
    remove: async (key: string) => { map.delete(key) },
    scan: async <T>(prefix: string) => [...map].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value: value as T })),
  }
  const tools: Record<string, any> = {}
  let observe: any
  const ctx = { tool: {
    transform: async (register: any) => { register({ namespace() {}, add(tool: any) { tools[tool.name] = tool } }); return { dispose() {} } },
    hook: async (_name: string, callback: any) => { observe = callback; return { dispose() {} } },
  } }
  await verificationCapability.setup({ ctx, state, config: {} as any })
  await taskContractCapability.setup({ ctx, state, config: {} as any })
  try {
    await m.tools.work_status.execute({ workId: "task" }, context)
    const contract = tools.task_contract
    await contract.execute({ op: "create", taskKind: "feature", goal: request, requirements: ["Implement and test the requested change"], constraints: ["Preserve existing API"] }, context)
    await runWorkUnitLifecycle("block", dir, "WU-1", { reason: "Hard-to-reverse delivery requires the user decision" })
    await assert.rejects(() => m.hooks["execute.before"]!(event("shell", "delivery-before-decision")), /execution paused/)
    m.user("authorized-delivery")
    assert.equal(content(await m.tools.work_resume.execute({ reason: "User authorized the delivery" }, context)).status, "active")
    await m.hooks["execute.before"]!(event("shell", "authorized-delivery"))
    await m.hooks["execute.after"]!(event("shell", "authorized-delivery", { status: "completed", result: {} }))
    await m.hooks["execute.before"]!(event("write", "code"))
    await writeFile(join(root, "src/validate.ts"), "export const validate = (s: string) => s.length > 0\n")
    await m.hooks["execute.after"]!(event("write", "code", { status: "completed", result: { output: { resource: "src/validate.ts" } } }))
    await runWorkUnitLifecycle("complete", dir, "WU-1", { evidence: "EV-1" })
    assert.equal(content(await m.tools.work_amend.execute({ ...routine }, context)).continue, true)
    await m.hooks["execute.before"]!(event("write", "test"))
    await writeFile(join(root, "tests/validate.test.ts"), "// Necessary coverage for REQ-1\n")
    await m.hooks["execute.after"]!(event("write", "test", { status: "completed", result: { output: { resource: "tests/validate.test.ts" } } }))
    await runWorkUnitLifecycle("complete", dir, "WU-2", { evidence: "EV-2" })
    await runWorkUnitLifecycle("complete", dir, "WU-3", { evidence: "EV-2" })
    const revision = "flow-revision"
    // Native execution is a fixture here, not a real OpenCode smoke.
    await observe(event("shell", "verify", { status: "completed", input: { command: "bun test" }, result: {} }))
    assert.equal(content(await tools.record_receipt.execute({ revision, check: "tests", command: "bun test", passed: true }, context)).stored, true)
    assert.equal(content(await tools.verify_revision.execute({ currentRevision: revision, requiredChecks: ["tests"] }, context)).ok, true)
    await contract.execute({ op: "record_evidence", requirementId: "REQ-1", type: "verification", reference: "tests", revision }, context)
    await contract.execute({ op: "update", requirementId: "REQ-1", status: "satisfied" }, context)
    assert.equal((await runWorkUnitLifecycle("status", dir)).completionReady, true)
    const gate = content(await tools.completion_gate.execute({ currentRevision: revision, requiredChecks: ["tests"], taskKind: "feature", docsStatus: "not-applicable", versionStatus: "not-applicable" }, context))
    assert.equal(gate.ok, true)
    assert.equal(gate.contractClosed, true)
    await runWorkUnitLifecycle("finalize", dir, undefined, { revision })
    assert.equal((await runWorkUnitLifecycle("status", dir)).status, "completed")
    assert(![...map.keys()].some((key) => /work-ledger|plan|review/.test(key)))
  } finally { cleanup(); await rm(root, { recursive: true, force: true }) }
})

test("blocked restart requires a fresh checkpoint response and cannot switch to another active Ledger", async () => {
  const { root, dir } = await fixture()
  await runWorkUnitLifecycle("amend", dir, undefined, { discovery: { ...routine, expectedFiles: [], humanDecision: true } })
  const m = mock(root)
  const cleanup = await setup(m)
  try {
    const restored = content(await m.tools.work_status.execute({ workId: "task" }, context))
    assert.equal(restored.checkpointRequired, true)
    await assert.rejects(() => m.hooks["execute.before"]!(event("write", "blocked-restart")), /execution paused/)
    assert.match((await m.tools.work_resume.execute({ reason: "pretend response" }, context)).content, /waiting for/)
    m.user("actual-response")
    assert.equal(content(await m.tools.work_resume.execute({ reason: "User chose the requested architecture" }, context)).status, "active")
    const other = join(root, ".andmar/work/other")
    await mkdir(other)
    const source = await readFile(join(dir, "WORK.md"), "utf8")
    await writeFile(join(other, "WORK.md"), source.replace("Work ID: task", "Work ID: other"))
    assert.match((await m.tools.work_status.execute({ workId: "other" }, context)).content, /Finish the current work/)
  } finally { cleanup(); await rm(root, { recursive: true, force: true }) }
})


test("operational Ledger metadata is excluded from product touches", async () => {
  const { root, dir } = await fixture()
  try {
    const before = await readFile(join(dir, "WORK.md"), "utf8")
    const result = await runWorkUnitLifecycle("touch", dir, "WU-1", { files: [".andmar/work/task/WORK.md"] })
    assert.equal(result.changed, false)
    assert.equal(await readFile(join(dir, "WORK.md"), "utf8"), before)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("unknown Work Unit markers are rejected programmatically", async () => {
  const { root, dir } = await fixture()
  try {
    const original = await readFile(join(dir, "WORK.md"), "utf8")
    await writeFile(join(dir, "WORK.md"), original.replace("[~] WU-1", "[approved] WU-1"))
    await assert.rejects(() => runWorkUnitLifecycle("status", dir), /Invalid Work Unit state/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("missing native VCS is a visible coverage gap and does not fail a native shell", async () => {
  const { root } = await fixture()
  const m = mock(root)
  ;(m.ctx as any).vcs = undefined
  const cleanup = await setup(m)
  try {
    await m.tools.work_status.execute({ workId: "task" }, context)
    await m.hooks["execute.before"]!(event("shell", "unavailable"))
    await m.hooks["execute.after"]!(event("shell", "unavailable", { status: "completed" }))
    const view = content(await m.tools.work_status.execute({}, context))
    assert.match(view.trackingError, /Native VCS status unavailable/)
    assert.equal(view.checkpointRequired, false)
  } finally { cleanup(); await rm(root, { recursive: true, force: true }) }
})


test("parallel activity stays visible until the last native call settles", async () => {
  const { root } = await fixture()
  const m = mock(root)
  const cleanup = await setup(m)
  try {
    await m.tools.work_status.execute({ workId: "task" }, context)
    await m.hooks["execute.before"]!(event("read", "read-a"))
    await m.hooks["execute.before"]!(event("grep", "read-b"))
    await m.hooks["execute.after"]!(event("read", "read-a", { status: "completed" }))
    assert.equal((await m.rpc().get({ sessionID: "s" })).currentActivity, "Running grep")
    await m.hooks["execute.after"]!(event("grep", "read-b", { status: "completed" }))
    assert.equal((await m.rpc().get({ sessionID: "s" })).currentActivity, null)
  } finally { cleanup(); await rm(root, { recursive: true, force: true }) }
})


test("observed checkpoint survives restart without asking again for an already-received response", async () => {
  const { root } = await fixture()
  const first = mock(root)
  const dispose = await setup(first)
  try {
    await first.tools.work_status.execute({ workId: "task" }, context)
    await first.tools.work_amend.execute({ ...routine, materialScope: true }, context)
    dispose()
    const restarted = mock(root)
    restarted.user("u2")
    const cleanup = await setup(restarted)
    try {
      await restarted.tools.work_status.execute({ workId: "task" }, context)
      const resumed = content(await restarted.tools.work_resume.execute({ reason: "The already-received response authorizes the exception" }, context))
      assert.equal(resumed.status, "active")
    } finally { cleanup() }
  } finally { await rm(root, { recursive: true, force: true }) }
})

// A–M: native Code Mode uses the SAME outer call ID for its child hooks
// (v2.0.20 packages/core/src/tool.ts and codemode/tool.ts).
for (const creation of ["humanDecision", "materialScope", "block"] as const) {
  for (const responseBeforeBind of [true, false]) {
    test(`checkpoint regression ${creation}: response ${responseBeforeBind ? "before" : "after"} restart/bind is order independent`, async () => {
      const { root, dir } = await fixture()
      const first = mock(root)
      const dispose = await setup(first)
      await first.tools.work_status.execute({ workId: "task" }, context)
      if (creation === "block") {
        await first.hooks["execute.before"]!(event("shell", "create", { input: { command: "lifecycle block" } }))
        await runWorkUnitLifecycle("block", dir, "WU-1", { reason: "User decision required" })
        // Decision arrives after the helper committed, BEFORE execute.after.
        first.user("decision-during-after")
        await first.hooks["execute.after"]!(event("shell", "create", { status: "completed", result: {} }))
      } else await first.tools.work_amend.execute({ ...routine, [creation]: true }, context)
      dispose()
      const blocked = await readFile(join(dir, "WORK.md"), "utf8")
      const second = mock(root)
      const cleanup = await setup(second)
      try {
        if (responseBeforeBind) second.user("u2")
        await second.tools.work_status.execute({ workId: "task" }, context)
        if (!responseBeforeBind) second.user("u2")
        for (const tool of ["work_status", "read", "search", "work_status", "grep", "glob", "list", "question", "status", "intake", "route", "task_contract"]) {
          await second.hooks["execute.before"]!(event(tool, `inspect-${tool}`))
          await second.tools.work_status.execute({}, context)
          await second.rpc().get(context)
          await second.hooks["execute.after"]!(event(tool, `inspect-${tool}`, { status: "completed", result: {} }))
        }
        assert.equal(await readFile(join(dir, "WORK.md"), "utf8"), blocked, "reads, bind and RPC are authorization-read-only")
        await second.hooks["execute.before"]!(event("execute", "outer"))
        for (const tool of ["edit", "write", "patch", "apply_patch", "shell", "bash", "delegate", "work_amend", "completion_gate"]) {
          await assert.rejects(() => second.hooks["execute.before"]!(event(tool, "outer")), /execution paused/)
        }
        for (const tool of ["work_resume", "andmar_work_resume", "andmar.work_resume", "andmar/work_resume"]) {
          await second.hooks["execute.before"]!(event(tool, "outer"))
        }
        const resumed = content(await second.tools.work_resume.execute({ reason: "User approved the decision" }, context))
        assert.equal(resumed.status, "active")
        await second.hooks["execute.after"]!(event("andmar.work_resume", "outer", { status: "completed", result: {} }))
        await second.hooks["execute.after"]!(event("execute", "outer", { status: "completed", result: {} }))
        assert.match((await second.tools.work_resume.execute({ reason: "Duplicate" }, context)).content, /no blocked Work Unit/)
        const resolved = await readFile(join(dir, "WORK.md"), "utf8")
        assert(!/Checkpoint User:|Checkpoint At:|Blocker:/.test(resolved))
        for (const tool of ["shell", "edit"]) {
          await second.hooks["execute.before"]!(event(tool, `post-${tool}`))
          await second.hooks["execute.after"]!(event(tool, `post-${tool}`, { status: "completed", result: { output: { resource: "src/resumed.ts" } } }))
        }
        assert.equal((await runWorkUnitLifecycle("status", dir)).checkpointRequired, false)
      } finally { cleanup(); await rm(root, { recursive: true, force: true }) }
    })
  }
}

test("checkpoint creation persists one boundary for both helper block and amendment", async () => {
  const { root, dir } = await fixture()
  try {
    await runWorkUnitLifecycle("block", dir, "WU-1", { reason: "Decision", checkpointUser: "u1" })
    assert.match(await readFile(join(dir, "WORK.md"), "utf8"), /Checkpoint User: u1/)
    assert.match(await readFile(join(dir, "WORK.md"), "utf8"), /Checkpoint At: \d+/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("checkpoint cannot resume from an older unrelated message or synthetic input", async () => {
  const { root, dir } = await fixture()
  const m = mock(root)
  const cleanup = await setup(m)
  try {
    await runWorkUnitLifecycle("block", dir, "WU-1", { reason: "Decision" })
    m.user("older-unrelated", 1)
    await m.tools.work_status.execute({ workId: "task" }, context)
    assert.match((await m.tools.work_resume.execute({ reason: "Not a posterior response" }, context)).content, /waiting for/)
    m.user("posterior")
    assert.equal(content(await m.tools.work_resume.execute({ reason: "Human resolved decision" }, context)).status, "active")
  } finally { cleanup(); await rm(root, { recursive: true, force: true }) }
})

test("legacy boundary missing: explicit one-time recovery persists across reads and restart", async () => {
  const { root, dir } = await fixture()
  const first = mock(root)
  const dispose = await setup(first)
  try {
    await runWorkUnitLifecycle("block", dir, "WU-1", { reason: "Legacy decision" })
    const path = join(dir, "WORK.md")
    await writeFile(path, (await readFile(path, "utf8")).replace(/^.*Checkpoint (?:At|User):.*\n/gm, ""))
    first.user("cannot-prove")
    await first.tools.work_status.execute({ workId: "task" }, context)
    const refused = await first.tools.work_resume.execute({ reason: "Legacy recovery" }, context)
    assert.match(refused.content, /legacy checkpoint.*boundary.*ask/i)
    const established = await readFile(path, "utf8")
    assert.match(established, /Checkpoint At:/)
    await first.tools.work_status.execute({ workId: "task" }, context)
    assert.equal(await readFile(path, "utf8"), established)
    dispose()
    const second = mock(root)
    const cleanup = await setup(second)
    try {
      second.user("new-human-decision")
      await second.tools.work_status.execute({ workId: "task" }, context)
      assert.equal(content(await second.tools.work_resume.execute({ reason: "Confirmed after recovery boundary" }, context)).status, "active")
    } finally { cleanup() }
  } finally { dispose(); await rm(root, { recursive: true, force: true }) }
})


test("pure checkpoint ordering: durable millis, DateTime, legacy context/native IDs, no != shortcut", () => {
  assert.equal(checkpointResponseAfter({ checkpointAt: 100, checkpointUser: "origin" }, [{ id: "reply", time: { created: { epochMilliseconds: 101 } } }]), true)
  for (const created of [99, 100, NaN]) assert.equal(checkpointResponseAfter({ checkpointAt: 100 }, [{ id: "reply", time: { created } }]), false)
  assert.equal(checkpointResponseAfter({ checkpointAt: 100, checkpointUser: "origin" }, [{ id: "origin", time: { created: 101 } }]), false)
  assert.equal(checkpointResponseAfter({ checkpointUser: "origin" }, [{ id: "origin" }, { id: "reply" }]), true)
  assert.equal(checkpointResponseAfter({ checkpointUser: "origin" }, [{ id: "unrelated" }]), false)
  const native = (prefix: string) => `msg_${prefix}${"A".repeat(14)}`
  assert.equal(checkpointResponseAfter({ checkpointUser: native("0123456789ab") }, [{ id: native("0123456789ac") }]), true)
  assert.equal(checkpointResponseAfter({ checkpointUser: native("0123456789ab") }, [{ id: native("0123456789aa") }]), false)
})

test("resume compares exact boundary under the Ledger lock and never resumes a newer checkpoint", async () => {
  const { root, dir } = await fixture()
  try {
    await runWorkUnitLifecycle("block", dir, "WU-1", { reason: "Decision", checkpointUser: "u1" })
    await assert.rejects(() => runWorkUnitLifecycle("resume", dir, "WU-1", { reason: "Stale response", expectedCheckpoint: { user: "wrong", at: null } }), /Checkpoint changed/)
    const view = await runWorkUnitLifecycle("status", dir)
    assert.equal(view.status, "blocked")
    await runWorkUnitLifecycle("resume", dir, "WU-1", { reason: "Resolved", expectedCheckpoint: { user: view.checkpointUser!, at: view.checkpointAt! } })
    await assert.rejects(() => runWorkUnitLifecycle("resume", dir, "WU-1", { reason: "Duplicate" }), /requires blocked/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("invalid and stale durable checkpoint boundaries are rejected", async () => {
  const { root, dir } = await fixture()
  try {
    const path = join(dir, "WORK.md")
    const active = await readFile(path, "utf8")
    await writeFile(path, active.replace("  - Expected Files:", "  - Checkpoint At: 42\n  - Expected Files:"))
    await assert.rejects(() => runWorkUnitLifecycle("status", dir), /Non-blocked/)
    await writeFile(path, active)
    await runWorkUnitLifecycle("block", dir, "WU-1", { reason: "Decision" })
    const blocked = await readFile(path, "utf8")
    await writeFile(path, blocked.replace(/Checkpoint At: \d+/, "Checkpoint At: NaN"))
    await assert.rejects(() => runWorkUnitLifecycle("status", dir), /Invalid Checkpoint At/)
    await writeFile(path, blocked.replace(/(Checkpoint At: \d+)/, "$1\n  - $1"))
    await assert.rejects(() => runWorkUnitLifecycle("status", dir), /Duplicate checkpoint boundary/)
  } finally { await rm(root, { recursive: true, force: true }) }
})


test("O: two session bindings enforce only the selected Ledger", async () => {
  const { root, dir } = await fixture()
  const m = mock(root)
  const dispose = await setup(m)
  try {
    const other = join(root, ".andmar/work/other")
    await mkdir(other)
    await writeFile(join(other, "WORK.md"), (await readFile(join(dir, "WORK.md"), "utf8")).replace("Work ID: task", "Work ID: other"))
    await m.tools.work_status.execute({ workId: "task" }, context)
    const second = { sessionID: "second" }
    await m.tools.work_status.execute({ workId: "other" }, second)
    const untouched = await readFile(join(other, "WORK.md"), "utf8")
    await m.tools.work_amend.execute({ ...routine, humanDecision: true }, context)
    await assert.rejects(() => m.hooks["execute.before"]!(event("edit", "blocked-selected")), /execution paused/)
    await m.hooks["execute.before"]!(event("edit", "other-selected", second))
    assert.equal(await readFile(join(other, "WORK.md"), "utf8"), untouched)
    assert.equal(content(await m.tools.work_status.execute({}, second)).checkpointRequired, false)
  } finally { dispose(); await rm(root, { recursive: true, force: true }) }
})
