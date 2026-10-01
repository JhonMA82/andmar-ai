import test from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runWork, createLedgerReader } from "../scripts/andmar-work.mjs"
import { setupWorkTracking } from "../src/capabilities/lifecycle/work.ts"

async function fixture(mode = "structured") {
  const root = await mkdtemp(join(tmpdir(), "andmar-interface-"))
  const dir = join(root, ".andmar/work/task")
  await runWork("init", dir, { mode, goal: "Deliver requested outcomes", source: "Original complete source",
    requirements: ["First outcome", "Unrelated second outcome"], constraints: ["Use native tools"],
    units: [{ title: "First", requirements: ["REQ-1"], acceptance: "First works", expectedFiles: ["src/**"] },
      { title: "Unrelated second", requirements: ["REQ-2"], acceptance: "Second works" }] })
  return { root, dir }
}
for (const mode of ["structured", "lightweight"]) test(`${mode}: semantic creation and compact lifecycle without full-document reads`, async () => {
  const { root, dir } = await fixture(mode)
  try {
    assert.equal((await runWork("validate", dir)).valid, true)
    await runWork("activate", dir, { unit: "WU-1" })
    const evidence = await runWork("record-evidence", dir, { description: "First real outcome observed" })
    assert.equal(evidence.evidence.id, "EV-1")
    const result = await runWork("complete", dir, { unit: "WU-1", evidence: evidence.evidence.id })
    assert.equal(result.active, "WU-2")
    assert.equal(result.units, undefined)
    const context = await runWork("context", dir)
    assert.equal(context.unit.id, "WU-2")
    assert.deepEqual(context.requirements, [{ id: "REQ-2", text: "Unrelated second outcome" }])
    assert.ok(!JSON.stringify(context).includes("First real outcome observed"))
    const status = await runWork("status", dir)
    assert.ok(JSON.stringify(status).length < 500)
    assert.equal(status.documents, undefined)
    assert.equal(status.units, undefined)
    const reader = createLedgerReader()
    const first = await reader.get(dir)
    assert.equal(first, await reader.get(dir), "unchanged version reuses projection without reparsing")
    const restarted = createLedgerReader()
    assert.equal((await restarted.get(dir)).active, "WU-2")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("EV-8 placeholder is replaced once; parallel allocation stays unique; real evidence cannot overwrite", async () => {
  const { root, dir } = await fixture()
  try {
    await writeFile(join(dir, "EVIDENCE.md"), "# Evidence\n\n## EV-8\n\nPending — recorded when WU-8 completes.\n")
    await runWork("record-evidence", dir, { id: "EV-8", description: "Real evidence" })
    assert.equal((await readFile(join(dir, "EVIDENCE.md"), "utf8")).match(/^## EV-8$/gm)?.length, 1)
    const before = await readFile(join(dir, "EVIDENCE.md"), "utf8")
    await assert.rejects(() => runWork("record-evidence", dir, { id: "EV-8", description: "Overwrite" }), /refusing overwrite/)
    assert.equal(await readFile(join(dir, "EVIDENCE.md"), "utf8"), before)
    const allocated = await Promise.all(["one", "two", "three"].map(description => runWork("record-evidence", dir, { description })))
    assert.equal(new Set(allocated.map(result => result.evidence.id)).size, 3)
    assert.equal((await runWork("validate", dir)).valid, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("invalid semantic payload never publishes a partial Ledger or overwrites existing state", async () => {
  const root = await mkdtemp(join(tmpdir(), "andmar-init-"))
  const dir = join(root, ".andmar/work/task")
  try {
    await assert.rejects(() => runWork("init", dir, { goal: "Goal", requirements: ["Actual"], source: "Source", units: [{ title: "Unit", requirements: ["REQ-99"], acceptance: "works" }] }), /unknown requirement/)
    await assert.rejects(() => readFile(join(dir, "WORK.md")), /ENOENT/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

for (const mode of ["structured", "lightweight"]) test(`${mode}: inline pending declaration is replaceable without duplicate evidence`, async () => {
  const { root, dir } = await fixture(mode)
  try {
    const name = mode === "structured" ? "EVIDENCE.md" : "WORK.md"
    const path = join(dir, name)
    const original = await readFile(path, "utf8")
    await writeFile(path, mode === "structured" ? "# Evidence\n\n## EV-8 — pending\n" : original.replace("## Evidence", "## Evidence\n- EV-8: pending"))
    const result = await runWork("record-evidence", dir, { id: "EV-8", description: "Observed outcome" })
    assert.equal(result.evidence.id, "EV-8")
    assert.equal((await readFile(path, "utf8")).match(/^(?:##|-) EV-8\b/gm)?.length, 1)
    assert.equal((await runWork("context", dir, { evidence: "EV-8" })).text, "Observed outcome")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("pending evidence cannot complete a WU and rejected mutation keeps original bytes", async () => {
  const { root, dir } = await fixture()
  try {
    await runWork("activate", dir, { unit: "WU-1" })
    await writeFile(join(dir, "EVIDENCE.md"), "# Evidence\n\n## EV-8\n\nPending — recorded later.\n")
    const before = await readFile(join(dir, "WORK.md"), "utf8")
    await assert.rejects(() => runWork("complete", dir, { unit: "WU-1", evidence: "EV-8" }), /pending evidence/)
    assert.equal(await readFile(join(dir, "WORK.md"), "utf8"), before)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("external changes invalidate the compact reader even with a same-length rewrite", async () => {
  const { root, dir } = await fixture()
  try {
    const reader = createLedgerReader()
    const first = await reader.get(dir)
    const path = join(dir, "WORK.md")
    await writeFile(path, (await readFile(path, "utf8")).replace("[ ] WU-1", "[~] WU-1"))
    const changed = await reader.get(dir)
    assert.notEqual(changed, first)
    assert.equal(changed.active, "WU-1")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("repair cannot clear a material checkpoint and enable product execution", async () => {
  const { root, dir } = await fixture()
  await runWork("activate", dir, { unit: "WU-1" })
  await runWork("block", dir, { unit: "WU-1", reason: "Unresolved product decision" })
  const tools: Record<string, any> = {}, hooks: Record<string, any> = {}
  const ctx: any = { location: { directory: root }, tool: {
    transform: async (fn: any) => { fn({ add: (tool: any) => tools[tool.name] = tool }); return {} },
    hook: async (name: string, fn: any) => { hooks[name] = fn; return {} },
  }, session: { context: async () => [] } }
  const dispose = await setupWorkTracking({ ctx, config: {} as any, state: {} as any })
  const event = (tool: string) => ({ tool, input: {}, sessionID: "s", id: "c" })
  try {
    await tools.work_status.execute({ workId: "task" }, { sessionID: "s" })
    const path = join(dir, "WORK.md")
    const blocked = await readFile(path, "utf8")
    await writeFile(path, blocked.replace("[!] WU-1", "[?] WU-1"))
    await hooks["execute.before"](event("read"))
    await writeFile(path, blocked.replace("Status: blocked", "Status: active").replace("[!] WU-1", "[~] WU-1").replace(/^  - Checkpoint At:.*\n/m, ""))
    await assert.rejects(() => hooks["execute.before"](event("shell")), /restore the trusted checkpoint/)
    await writeFile(path, blocked)
    await assert.rejects(() => hooks["execute.before"](event("shell")), /checkpoint required/)
  } finally { dispose(); await rm(root, { recursive: true, force: true }) }
})

for (const corruption of ["duplicate EV", "invalid WU state", "dangling REQ"]) test(`recovery without restart: ${corruption}`, async () => {
  const { root, dir } = await fixture()
  const tools: Record<string, any> = {}, hooks: Record<string, any> = {}
  const ctx: any = { location: { directory: root }, tool: {
    transform: async (fn: any) => { fn({ add: (tool: any) => tools[tool.name] = tool }); return {} },
    hook: async (name: string, fn: any) => { hooks[name] = fn; return {} },
  }, session: { context: async () => [] } }
  const dispose = await setupWorkTracking({ ctx, config: {} as any, state: {} as any })
  const context = { sessionID: "session" }
  const event = (tool: string, input = {}) => ({ tool, input, sessionID: "session", id: "call" })
  try {
    await tools.work_status.execute({ workId: "task" }, context)
    const path = join(dir, corruption === "duplicate EV" ? "EVIDENCE.md" : "WORK.md")
    const original = await readFile(path, "utf8")
    const invalid = corruption === "duplicate EV" ? "# Evidence\n\n## EV-8\nReal\n\n## EV-8\nPending\n" : corruption === "invalid WU state" ? original.replace("[ ] WU-1", "[?] WU-1") : original.replace("Requirements: REQ-1", "Requirements: REQ-99")
    await writeFile(path, invalid)
    for (const tool of ["read", "grep", "search", "question", "andmar.work_status"]) await hooks["execute.before"](event(tool))
    const status = JSON.parse((await tools.work_status.execute({}, context)).content)
    assert.equal(status.recoveryRequired, true)
    assert.equal(status.completionReady, false)
    for (const tool of ["shell", "andmar.completion_gate", "andmar.work_resume"]) await assert.rejects(() => hooks["execute.before"](event(tool)), /recovery required/)
    await assert.rejects(() => hooks["execute.before"](event("write", { filePath: "src/product.ts" })), /recovery required/)
    await hooks["execute.before"](event("write", { filePath: path }))
    await writeFile(path, original)
    await hooks["execute.before"](event("read"))
    const recovered = JSON.parse((await tools.work_status.execute({}, context)).content)
    assert.equal(recovered.status, "active")
    assert.equal(recovered.recoveryRequired, undefined)
  } finally { dispose(); await rm(root, { recursive: true, force: true }) }
})
