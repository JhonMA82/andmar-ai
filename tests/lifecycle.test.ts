import test from "node:test"
import assert from "node:assert/strict"
import {
  analyzeDocumentationImpact,
  evaluateCompletion,
  inferVersionImpact,
} from "../src/core/lifecycle.ts"

const rules = [
  { id: "api", code: ["src/api/**"], docs: ["docs/api/**", "README.md"] },
]

const CLEAN = { docsStatus: "clean", versionStatus: "clean" } as const
const GREEN = { ok: true, missing: [], failed: [], unverified: [], reasons: [] }

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

test("completion cannot be formally verified when required verification is missing", () => {
  const missing = {
    ok: false,
    missing: ["tests", "typecheck"],
    failed: [],
    unverified: [],
    reasons: ["missing receipts for: tests, typecheck"],
  }
  const result = evaluateCompletion("rev-a", CLEAN, missing, ["tests", "typecheck"])
  assert.equal(result.ok, false)
  assert.match(result.reasons.join(" "), /required verification/)
  assert.match(result.reasons.join(" "), /missing receipts/)
  // The revision is named, so the agent can see which state is unverified.
  assert.match(result.reasons.join(" "), /rev-a/)
})

test("completion is denied when a required check failed", () => {
  const failed = {
    ok: false,
    missing: [],
    failed: ["tests"],
    unverified: [],
    reasons: ["failed checks: tests"],
  }
  assert.equal(evaluateCompletion("rev-a", CLEAN, failed, ["tests"]).ok, false)
})

test("completion is denied when a receipt is unverified", () => {
  const unverified = {
    ok: false,
    missing: [],
    failed: [],
    unverified: ["tests"],
    reasons: ["unverified receipts (no valid completed same-revision execution): tests"],
  }
  const result = evaluateCompletion("rev-a", CLEAN, unverified, ["tests"])
  assert.equal(result.ok, false)
  assert.match(result.reasons.join(" "), /unverified/)
})

test("completion passes when required verification is satisfied", () => {
  assert.equal(evaluateCompletion("rev-a", CLEAN, GREEN, ["tests", "typecheck"]).ok, true)
})

test("completion is denied by stale documentation and a required version bump", () => {
  const stale = evaluateCompletion("rev-a", { docsStatus: "stale", versionStatus: "clean" }, GREEN, ["tests"])
  assert.equal(stale.ok, false)
  assert.match(stale.reasons.join(" "), /documentation is potentially stale/)

  const needsVersion = evaluateCompletion("rev-a", { docsStatus: "clean", versionStatus: "required" }, GREEN, ["tests"])
  assert.equal(needsVersion.ok, false)
  assert.match(needsVersion.reasons.join(" "), /version\/changelog update is still required/)
})

test("a denied requirement gate is reported with its own reasons", () => {
  const pending = {
    ok: false,
    pending: ["REQ-3"],
    blocked: [],
    missingEvidence: [],
    stale: [],
    reasons: ["pending requirements: REQ-3"],
    total: 3,
    satisfied: 2,
  }
  const result = evaluateCompletion("rev-a", CLEAN, GREEN, ["tests"], pending)
  assert.equal(result.ok, false)
  assert.match(result.reasons.join(" "), /task contract: pending requirements: REQ-3/)
})

test("completion stays proportional when no checks are genuinely required", () => {
  const missing = {
    ok: false,
    missing: ["tests"],
    failed: [],
    unverified: [],
    reasons: ["missing receipts for: tests"],
  }
  assert.equal(evaluateCompletion("rev-a", CLEAN, missing, []).ok, true)
})

test("Work Ledger path touches neither public surface nor documentation rules", () => {
  const ledgerPath = ".andmar/work/sample-task/WORK.md"
  const defaultPublicPaths = ["src/**", "packages/**", "apps/**"]
  const touchesPublicSurface = defaultPublicPaths.some((p) => {
    // simple prefix / glob check matching defaultConfig
    return ledgerPath.startsWith("src/") || ledgerPath.startsWith("packages/") || ledgerPath.startsWith("apps/")
  })
  assert.equal(touchesPublicSurface, false)
  assert.equal(inferVersionImpact({ kind: "feature", touchesPublicSurface }), "none")
  const result = analyzeDocumentationImpact([ledgerPath], rules)
  assert.equal(result.status, "not-applicable")
  assert.deepEqual(result.affectedRuleIDs, [])
})
