import test from "node:test"
import assert from "node:assert/strict"
import {
  receiptKey,
  receiptPrefix,
  summarizeVerification,
  truncateOutput,
  type VerificationReceipt,
} from "../src/capabilities/verification/receipts.ts"
import { detectProjectChecks } from "../src/capabilities/verification/detect.ts"

function receipt(overrides: Partial<VerificationReceipt> & { revision: string; check: VerificationReceipt["check"] }): VerificationReceipt {
  return { passed: true, at: 1_700_000_000_000, ...overrides }
}

test("verification passes when every required check passed at the exact revision", () => {
  const summary = summarizeVerification("rev-a", [
    receipt({ revision: "rev-a", check: "tests" }),
    receipt({ revision: "rev-a", check: "typecheck" }),
  ])
  assert.equal(summary.ok, true)
  assert.deepEqual(summary.missing, [])
  assert.deepEqual(summary.failed, [])
})

test("verification reports missing checks", () => {
  const summary = summarizeVerification("rev-a", [receipt({ revision: "rev-a", check: "tests" })])
  assert.equal(summary.ok, false)
  assert.deepEqual(summary.missing, ["typecheck"])
  assert.match(summary.reasons.join(" "), /missing receipts/)
})

test("verification reports failed checks", () => {
  const summary = summarizeVerification("rev-a", [
    receipt({ revision: "rev-a", check: "tests", passed: false }),
    receipt({ revision: "rev-a", check: "typecheck" }),
  ])
  assert.equal(summary.ok, false)
  assert.deepEqual(summary.failed, ["tests"])
  assert.match(summary.reasons.join(" "), /failed checks/)
})

test("receipts from another revision do not satisfy the current revision", () => {
  const summary = summarizeVerification("rev-b", [
    receipt({ revision: "rev-a", check: "tests" }),
    receipt({ revision: "rev-a", check: "typecheck" }),
  ])
  assert.equal(summary.ok, false)
  assert.deepEqual(summary.missing, ["tests", "typecheck"])
})

test("the latest receipt wins when a check is recorded twice", () => {
  const summary = summarizeVerification("rev-a", [
    receipt({ revision: "rev-a", check: "tests", passed: false, at: 100 }),
    receipt({ revision: "rev-a", check: "tests", passed: true, at: 200 }),
    receipt({ revision: "rev-a", check: "typecheck" }),
  ])
  assert.equal(summary.ok, true)
  assert.equal(summary.results["tests"]?.at, 200)
})

test("custom required check sets are honored", () => {
  const summary = summarizeVerification(
    "rev-a",
    [receipt({ revision: "rev-a", check: "build" })],
    ["build"],
  )
  assert.equal(summary.ok, true)
})

test("long outputs are truncated with a marker", () => {
  assert.equal(truncateOutput("abc", 10), "abc")
  const truncated = truncateOutput("x".repeat(100), 10)
  assert.ok(truncated.length < 100)
  assert.match(truncated, /truncated by AndMar AI/)
})

test("revision keys do not collide across slashes", () => {
  assert.notEqual(receiptKey("a/b", "tests"), receiptKey("a", "b/tests"))
  assert.ok(receiptKey("a/b", "tests").startsWith(receiptPrefix("a/b")))
})

test("detection finds bun from its lockfile and tsc from tsconfig", () => {
  const result = detectProjectChecks(["package.json", "bun.lock", "tsconfig.json", "src/index.ts"])
  assert.equal(result.unknown, false)
  assert.equal(result.ecosystems.length, 1)
  const bun = result.ecosystems[0]
  assert.equal(bun?.id, "bun")
  assert.deepEqual(bun?.signals, ["package.json", "bun.lock"])
  const byKind = Object.fromEntries((bun?.checks ?? []).map((check) => [check.check, check]))
  assert.equal(byKind["tests"]?.command, "bun test")
  assert.equal(byKind["typecheck"]?.command, "bunx tsc --noEmit")
})

test("detection falls back to npm when only package.json exists", () => {
  const result = detectProjectChecks(["package.json"])
  assert.equal(result.ecosystems[0]?.id, "node")
  assert.equal(result.ecosystems[0]?.checks[0]?.command, "npm test")
})

test("detection maps package scripts deterministically", () => {
  const result = detectProjectChecks(
    ["package.json", "package-lock.json"],
    ["test", "lint", "typecheck", "build", "check"],
  )
  const commands = Object.fromEntries(
    (result.ecosystems[0]?.checks ?? []).map((check) => [`${check.check}:${check.source}`, check.command]),
  )
  assert.equal(commands["tests:script"], "npm run test")
  assert.equal(commands["lint:script"], "npm run lint")
  assert.equal(commands["typecheck:script"], "npm run typecheck")
  assert.equal(commands["build:script"], "npm run build")
  assert.equal(commands["custom:script"], "npm run check")
})

test("detection prefers the first matching lockfile and matches basenames in subpaths", () => {
  const result = detectProjectChecks(["sub/Cargo.toml", "go.mod", "backend/uv.lock", "backend/pyproject.toml"])
  const ids = result.ecosystems.map((ecosystem) => ecosystem.id)
  assert.deepEqual(ids, ["cargo", "go", "python"])
  const python = result.ecosystems.find((ecosystem) => ecosystem.id === "python")
  assert.equal(python?.checks[0]?.command, "uv run pytest")
})

test("detection reports unknown when no signal files exist", () => {
  assert.deepEqual(detectProjectChecks(["README.md", "src/main.ts"]), { ecosystems: [], unknown: true })
  assert.deepEqual(detectProjectChecks([]), { ecosystems: [], unknown: true })
})
