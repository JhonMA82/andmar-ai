import test from "node:test"
import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
const agent = await readFile(new URL("../assets/agents/andmar.md", import.meta.url), "utf8")
const skillRoot = new URL("../assets/skills/", import.meta.url)
const skills = await readdir(skillRoot)
test("primary agent uses native skill discovery without model pinning", () => {
  const fm = agent.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ""
  assert.match(fm, /^mode: primary$/m)
  assert.doesNotMatch(fm, /^model:/m)
  assert.match(agent, /native skill tool/)
  for (const name of skills) assert.ok(agent.includes(name), `missing skill route ${name}`)
})
test("procedures have one skill owner and are progressively disclosed", async () => {
  assert.deepEqual(skills.sort(), ["andmar-acceptance", "andmar-git-lifecycle", "andmar-repo-navigation", "andmar-verification", "andmar-work-ledger"])
  const bodies = await Promise.all(skills.map(name => readFile(new URL(`${name}/SKILL.md`, skillRoot), "utf8")))
  for (let i = 0; i < skills.length; i++) {
    assert.ok(bodies[i]!.includes(`name: ${skills[i]}`))
    assert.match(bodies[i]!, /^description: .+/m)
    assert.doesNotMatch(bodies[i]!, /TODO|placeholder skill/i)
  }
  for (const recipe of ["--evidence", "--commit", "prepare <ledger-dir>", "record_receipt({"]) assert.ok(!agent.includes(recipe))
})
test("agent retains autonomy, obligation identity and completion authority", () => {
  assert.match(agent, /Execute autonomously/)
  assert.match(agent, /preserve their identity/)
  assert.match(agent, /only\nnormal transition to completed/)
  assert.match(agent, /invalid Ledger blocks product mutation\/completion/)
  assert.match(agent, /never describe mocks as real runtime acceptance/)
})
