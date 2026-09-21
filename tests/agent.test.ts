import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const agent = await readFile(new URL("../assets/agents/andmar.md", import.meta.url), "utf8")

test("AndMar is a primary agent and does not pin a model", () => {
  const frontmatter = agent.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ""
  assert.match(frontmatter, /^mode:\s*primary$/m)
  assert.doesNotMatch(frontmatter, /^model:/m)
})

test("AndMar agent requires the existing verification and lifecycle primitives", () => {
  for (const primitive of [
    "andmar_status",
    "andmar_suggest_checks",
    "andmar_record_receipt",
    "andmar_verify_revision",
    "andmar_change_impact",
    "andmar_completion_gate",
  ]) {
    assert.match(agent, new RegExp(`\\b${primitive}\\b`))
  }
  assert.match(agent, /Implementation success is not task completion/i)
  assert.match(agent, /working-state revision fingerprint/i)
})

test("AndMar agent requires stronger evidence for migrations and integrations", () => {
  assert.match(agent, /authoritative\/current sources/i)
  assert.match(agent, /real runtime or integration boundary/i)
  assert.match(agent, /tests that only validate mocks/i)
})
