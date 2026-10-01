import test from "node:test"
import assert from "node:assert/strict"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { checkArchitecture } from "../scripts/check-architecture.mjs"
import { capabilityArtifacts } from "../scripts/generate-capability-manifest.mjs"

const source = fileURLToPath(new URL("../", import.meta.url))
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "andmar-architecture-"))
  for (const name of ["src", "assets", "docs", "scripts", "package.json", "CHANGELOG.md"]) await cp(join(source, name), join(root, name), { recursive: true })
  return root
}
async function put(root: string, path: string, content: string) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), content)
}

test("architecture baseline and isolated fixtures preserve deliberate shared read contracts", async () => {
  const root = await fixture()
  try {
    await put(root, "tests/fixtures/skill-registry.json", "{}")
    await put(root, "tests/fixtures/andmar.md", await readFile(join(root, "assets/agents/andmar.md"), "utf8"))
    await put(root, "src/capabilities/routing/comment.ts", '// import bad from "../lifecycle/index.ts"\nexport type Kind = "review"\n')
    assert.deepEqual((await checkArchitecture(root)).failures, [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("architecture rejects normalized relative sibling imports, integration inversion and consumer internals", async () => {
  const root = await fixture()
  try {
    await put(root, "src/capabilities/routing/nested/bad.ts", 'export { x } from "../../lifecycle/impact.ts"\nconst y = import("../../../capabilities/verification/index.ts")\n')
    await put(root, "src/integrations/jev/bad.ts", 'import type { Binding } from "../../capabilities/lifecycle/work.ts"\n')
    await put(root, "src/presentation/bad.ts", 'import { x } from "../core/state.ts"\nimport { y } from "../capabilities/lifecycle/work.ts"\nconst z = import(`../core/contracts.ts`)\n')
    const failures = (await checkArchitecture(root)).failures.join("\n")
    assert.match(failures, /sibling implementation.*lifecycle/)
    assert.match(failures, /sibling implementation.*verification/)
    assert.match(failures, /Integration .*capability implementation/)
    assert.match(failures, /consumer .*internal .*core/)
    assert.match(failures, /consumer .*internal .*capabilities/)
    assert.match(failures, /consumer .*internal .*contracts.ts/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("architecture rejects forbidden core ownership, runtime dependency and domain logic", async () => {
  const root = await fixture()
  try {
    await put(root, "src/core/nested/bad.ts", 'import a from "../../capabilities/lifecycle/index.ts"\nimport b from "../../integrations/jev/client.ts"\nimport c from "../../../assets/skills/andmar-work-ledger/SKILL.md"\nimport type { X } from "@opencode/plugin"\nexport const runWorkLedger = () => null\n')
    const failures = (await checkArchitecture(root)).failures.join("\n")
    for (const term of [/capabilities/, /integrations/, /assets\/skills/, /@opencode\/plugin/, /domain\/presentation\/workflow/]) assert.match(failures, term)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("architecture rejects parallel agent, missing skill entry and proprietary registries without fixing a skill count", async () => {
  const root = await fixture()
  try {
    await put(root, ".opencode/agents/andmar.md", "parallel source")
    await mkdir(join(root, "assets/skills/additional"))
    for (const name of ["skills.json", "skill-registry.mjs", "workflow-registry.json", "plugin-registry.json"]) await put(root, name, "{}")
    let failures = (await checkArchitecture(root)).failures.join("\n")
    assert.match(failures, /Parallel primary agent/)
    assert.match(failures, /additional.*missing SKILL/)
    assert.equal(failures.match(/Proprietary registry/g)?.length, 4)
    await rm(join(root, ".opencode"), { recursive: true })
    for (const name of ["skills.json", "skill-registry.mjs", "workflow-registry.json", "plugin-registry.json"]) await rm(join(root, name))
    await put(root, "assets/skills/additional/SKILL.md", "---\nname: additional\ndescription: Real new procedure\n---\nProcedure\n")
    const result = await checkArchitecture(root)
    assert.equal(result.skills, 6)
    assert.deepEqual(result.failures, [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("architecture rejects functional legacy, stale generated files and duplicate tool ownership", async () => {
  const root = await fixture()
  try {
    await put(root, "src/capabilities/routing/legacy.ts", 'const CompletionSeal = 1; const completionSealKey = 2; const contractStateToken = 3; const request_review = 4; const andmar_request_review = 5; const ANDMAR_REVIEW_ENABLED = true; const reviewRounds = 2; const reviewBudget = 4; const testsPassed = true; import x from "task-contract-completion"\n')
    const failures = (await checkArchitecture(root)).failures.join("\n")
    for (const symbol of ["CompletionSeal", "completionSealKey", "contractStateToken", "request_review", "andmar_request_review", "ANDMAR_REVIEW_ENABLED", "reviewRounds", "reviewBudget", "testsPassed", "task-contract-completion"]) assert.ok(failures.includes(`Functional legacy symbol ${symbol}`), symbol)
    await rm(join(root, "src/capabilities/routing/legacy.ts"))
    await writeFile(join(root, "docs/CAPABILITIES.md"), (await readFile(join(root, "docs/CAPABILITIES.md"), "utf8")).replace("| 5 |", "| 500 |"))
    await writeFile(join(root, "src/generated/capabilities.ts"), (await readFile(join(root, "src/generated/capabilities.ts"), "utf8")) + "\n// drift\n")
    assert.equal((await checkArchitecture(root)).failures.filter(f => f.includes("exactly synchronized")).length, 2)
    await put(root, "src/capabilities/routing/duplicate.ts", 'editor.add({ name: "work_status" })\n')
    for (const [path, content] of (await capabilityArtifacts(root)).files) await writeFile(join(root, path), content)
    assert.match((await checkArchitecture(root)).failures.join("\n"), /duplicate ownership/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
