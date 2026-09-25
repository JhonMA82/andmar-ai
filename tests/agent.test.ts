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

test("AndMar agent holds the reinforced migration/integration termination criteria", () => {
  assert.match(agent, /installed API\/type shape/i)
  assert.match(agent, /deprecated\/transitional API scan/i)
  assert.match(agent, /migration notes\/changelog/i)
  assert.match(agent, /explicitly.*limitation|limitation.*explicitly/i)
  assert.match(agent, /executionId/i)
})

test("AndMar agent uses intake before non-trivial execution", () => {
  assert.match(agent, /andmar_intake\b/)
  assert.match(agent, /needsRefinement/i)
  assert.match(agent, /Internal Task Brief/i)
  assert.match(agent, /routeSignals/i)
  assert.match(agent, /fallback.*never blocks|never blocks.*fallback/i)
})

test("AndMar agent preserves raw-request obligations through intake compression", () => {
  assert.match(agent, /raw user request remains authoritative/i)
  assert.match(agent, /brief.*never replace|never replace.*brief/i)
  assert.match(agent, /never remove obligations/i)
  assert.match(agent, /surface contradictions|contradictions.*surface/i)
  assert.match(agent, /every explicit requirement and constraint/i)
  assert.match(agent, /Never derive the contract solely from a compressed brief/i)
})

test("AndMar agent does not summarize requests before intake", () => {
  assert.match(agent, /reads the authoritative raw user request directly from the current OpenCode session/i)
  assert.match(agent, /Do not paraphrase, summarize, or pass the request as a tool argument/i)
})

test("AndMar agent works through a Task Contract and separates tests from completion", () => {
  assert.match(agent, /andmar_task_contract\b/)
  assert.match(agent, /andmar_request_review\b/)
  assert.match(agent, /Passing tests prove only what those tests cover/i)
  assert.match(agent, /not only against the implementation plan you created yourself/i)
  assert.match(agent, /Compaction does not end the task/i)
  assert.match(agent, /steer.*active contract|active contract.*steer/i)
})

test("AndMar agent reports change, verification, requirements and limitations on completion", () => {
  assert.match(agent, /what changed, how it was verified/i)
  assert.match(agent, /which requirements were met|requirements.*met/i)
  assert.match(agent, /which real limitations remain|limitations remain/i)
  assert.match(agent, /two (stored )?rejects the task is blocked|After two (stored )?rejects/i)
})

test("AndMar agent handles post-completion operational continuations proportionally", () => {
  assert.match(agent, /continuation\.fastPath=true/)
  assert.match(agent, /Do not call `andmar_request_review`/)
  assert.match(agent, /Do not call `andmar_completion_gate` again/)
  assert.match(agent, /proportional checks/i)
})

test("AndMar agent passes taskKind through contract and completion boundaries", () => {
  assert.match(agent, /Task Contract.*taskKind|taskKind.*Task Contract/i)
  assert.match(agent, /completion_gate.*taskKind|taskKind.*completion_gate/i)
  assert.match(agent, /runtime.*derived.*taskKind|taskKind.*runtime.*derived/i)
})

test("AndMar agent definitions in assets and .opencode are synchronized and clean of escaped literals", async () => {
  const opencodeAgent = await readFile(new URL("../.opencode/agents/andmar.md", import.meta.url), "utf8");
  assert.equal(agent, opencodeAgent);
  assert.doesNotMatch(agent, /\\x27/);
  assert.match(agent, /OpenCode's/);
  assert.match(agent, /No hidden context/i);
  assert.match(agent, /AndMar may use available context but must never depend on invisible context/i);
});

test("AndMar agent uses intake workProjection and manages repository Work Ledger", () => {
  assert.match(agent, /workProjection\.mode/i);
  assert.match(agent, /lightweight/i);
  assert.match(agent, /structured/i);
  assert.match(agent, /\.andmar\/work/i);
});

test("AndMar agent preserves separation between Work Ledger and Task Contract", () => {
  assert.match(agent, /Work Ledger is portable continuity;\s*Task Contract is runtime completion projection/i);
});

test("AndMar agent resumes from Work Ledger before restarting from scratch", () => {
  assert.match(agent, /Consult `?\.andmar\/work\/\*\/WORK\.md`? before restarting from scratch/i);
  assert.match(agent, /reconstruct the Task Contract from the Ledger's Goal, requirements, and constraints/i);
  assert.match(agent, /Do not redo completed work units/i);
});

test("AndMar agent manipulates Work Ledger files with native OpenCode tools", () => {
  assert.match(agent, /using native OpenCode tools \(`read`, `write`, `edit`\)/i);
});

test("AndMar agent forbids hidden context across all modes and ledger assertions", () => {
  assert.match(agent, /invisible context/i);
  assert.match(agent, /Every durable assertion must be traceable to the current user request, the repository, the Work Ledger itself/i);
});

test("AndMar agent retains andmar_completion_gate without introducing a second completion gate", () => {
  assert.match(agent, /andmar_completion_gate\b/);
  assert.doesNotMatch(agent, /andmar_work_completion\b/);
});
