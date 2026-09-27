import test from "node:test"
import assert from "node:assert/strict"
import {
  analyzeDocumentationImpact,
  evaluateCompletion,
  evaluateCompletionWithVerification,
  inferVersionImpact,
} from "../src/core/lifecycle.ts"

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

test("completion gate cannot formally verify when required verification is missing", () => {
  const evidence = {
    revision: "rev-a",
    testsPassed: true,
    reviewPassed: true,
    docsStatus: "clean" as const,
    versionStatus: "clean" as const,
  }
  const missing = {
    ok: false,
    missing: ["tests", "typecheck"],
    failed: [],
    unverified: [],
    reasons: ["missing receipts for: tests, typecheck"],
  }
  const gated = evaluateCompletionWithVerification("rev-a", evidence, missing, ["tests", "typecheck"])
  assert.equal(gated.ok, false)
  assert.match(gated.reasons.join(" "), /required verification/)
  assert.match(gated.reasons.join(" "), /missing receipts/)
})

test("completion gate cannot be bypassed with manual testsPassed when verification failed", () => {
  const evidence = {
    revision: "rev-a",
    testsPassed: true,
    docsStatus: "clean" as const,
    versionStatus: "clean" as const,
  }
  const failed = {
    ok: false,
    missing: [],
    failed: ["tests"],
    unverified: [],
    reasons: ["failed checks: tests"],
  }
  assert.equal(evaluateCompletionWithVerification("rev-a", evidence, failed, ["tests"]).ok, false)
})

test("completion gate cannot be bypassed when receipts are unverified", () => {
  const evidence = {
    revision: "rev-a",
    testsPassed: true,
    docsStatus: "clean" as const,
    versionStatus: "clean" as const,
  }
  const unverified = {
    ok: false,
    missing: [],
    failed: [],
    unverified: ["tests"],
    reasons: ["unverified receipts (no valid completed same-revision execution): tests"],
  }
  const gated = evaluateCompletionWithVerification("rev-a", evidence, unverified, ["tests"])
  assert.equal(gated.ok, false)
  assert.match(gated.reasons.join(" "), /unverified/)
})

test("completion gate passes when required verification is satisfied", () => {
  const evidence = {
    revision: "rev-a",
    testsPassed: true,
    docsStatus: "clean" as const,
    versionStatus: "clean" as const,
  }
  const clean = { ok: true, missing: [], failed: [], unverified: [], reasons: [] }
  assert.equal(evaluateCompletionWithVerification("rev-a", evidence, clean, ["tests", "typecheck"]).ok, true)
})

test("completion gate stays proportional when no checks are genuinely required", () => {
  const evidence = {
    revision: "rev-a",
    testsPassed: true,
    docsStatus: "not-applicable" as const,
    versionStatus: "not-applicable" as const,
  }
  const missing = {
    ok: false,
    missing: ["tests"],
    failed: [],
    unverified: [],
    reasons: ["missing receipts for: tests"],
  }
  assert.equal(evaluateCompletionWithVerification("rev-a", evidence, missing, []).ok, true)
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
