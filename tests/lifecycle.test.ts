import test from "node:test"
import assert from "node:assert/strict"
import { analyzeDocumentationImpact, evaluateCompletion, inferVersionImpact } from "../src/core/lifecycle.ts"

const rules = [
  { id: "api", code: ["src/api/**"], docs: ["docs/api/**", "README.md"] },
]

test("marks mapped documentation stale when implementation changes alone", () => {
  const result = analyzeDocumentationImpact(["src/api/users.ts"], rules)
  assert.equal(result.status, "stale")
  assert.deepEqual(result.affectedRuleIDs, ["api"])
})

test("clears mapped documentation when docs change in the same revision", () => {
  const result = analyzeDocumentationImpact(["src/api/users.ts", "docs/api/users.md"], rules)
  assert.equal(result.status, "clean")
})

test("infers conservative semver impact for public changes", () => {
  assert.equal(inferVersionImpact({ kind: "feature", touchesPublicSurface: true }), "minor")
  assert.equal(inferVersionImpact({ kind: "bugfix", touchesPublicSurface: true }), "patch")
  assert.equal(inferVersionImpact({ kind: "feature", touchesPublicSurface: true, breaking: true }), "major")
  assert.equal(inferVersionImpact({ kind: "internal", touchesPublicSurface: false }), "none")
})

test("completion evidence is invalidated by revision changes", () => {
  const result = evaluateCompletion("rev-b", {
    revision: "rev-a",
    testsPassed: true,
    reviewPassed: true,
    docsStatus: "clean",
    versionStatus: "clean",
  })
  assert.equal(result.ok, false)
  assert.match(result.reasons.join(" "), /stale/)
})
