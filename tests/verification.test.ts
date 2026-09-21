import test from "node:test"
import assert from "node:assert/strict"
import {
  receiptKey,
  receiptPrefix,
  summarizeVerification,
  truncateOutput,
  type VerificationReceipt,
} from "../src/capabilities/verification/receipts.ts"
import {
  bindExecutionToRevision,
  buildExecutionEvidence,
  executionEvidenceKey,
  EXECUTION_EVIDENCE_PREFIX,
  extractCommand,
  isAndMarTool,
  isValidExecutionId,
  normalizeCommand,
  resolveCompatibleExecution,
  validateReceiptEvidence,
  type ExecutionEvidence,
} from "../src/capabilities/verification/evidence.ts"
import { detectProjectChecks } from "../src/capabilities/verification/detect.ts"

function receipt(overrides: Partial<VerificationReceipt> & { revision: string; check: VerificationReceipt["check"] }): VerificationReceipt {
  return { passed: true, at: 1_700_000_000_000, ...overrides }
}

function evidence(overrides: Partial<ExecutionEvidence> & { executionId: string }): ExecutionEvidence {
  return { tool: "bash", status: "completed", at: 1_700_000_000_000, ...overrides }
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
  const summary = summarizeVerification("rev-a", [receipt({ revision: "rev-a", check: "build" })], ["build"])
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
  const result = detectProjectChecks(["package.json", "package-lock.json"], ["test", "lint", "typecheck", "build", "check"])
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

test("a passed receipt without execution evidence is refused", () => {
  assert.equal(validateReceiptEvidence({ revision: "rev-a", passed: true }, undefined).ok, false)
  assert.equal(validateReceiptEvidence({ revision: "rev-a", passed: true, executionId: "  " }, undefined).ok, false)
  assert.equal(validateReceiptEvidence({ revision: "rev-a", passed: true, executionId: "exec-1" }, undefined).ok, false)
  const refused = validateReceiptEvidence({ revision: "rev-a", passed: true }, undefined)
  assert.match((refused.ok ? "" : refused.reason), /executionId/)
})

test("a failed execution can never become a passed receipt", () => {
  const failed = evidence({ executionId: "exec-fail", status: "error" })
  const result = validateReceiptEvidence({ revision: "rev-a", passed: true, executionId: "exec-fail" }, failed)
  assert.equal(result.ok, false)
  assert.match((result.ok ? "" : result.reason), /failed execution|cannot become|did not complete/)
})

test("a valid completed execution produces acceptable evidence", () => {
  const completed = evidence({ executionId: "exec-1" })
  assert.equal(
    validateReceiptEvidence({ revision: "rev-a", passed: true, executionId: "exec-1" }, completed).ok,
    true,
  )
  const summary = summarizeVerification(
    "rev-a",
    [
      receipt({ revision: "rev-a", check: "tests", executionId: "exec-1" }),
      receipt({ revision: "rev-a", check: "typecheck", executionId: "exec-2" }),
    ],
    ["tests", "typecheck"],
    { "exec-1": completed, "exec-2": evidence({ executionId: "exec-2" }) },
  )
  assert.equal(summary.ok, true)
  assert.deepEqual(summary.unverified, [])
})

test("evidence bound to another revision cannot satisfy the current revision", () => {
  const bound = evidence({ executionId: "exec-1", revision: "rev-a" })
  const result = validateReceiptEvidence({ revision: "rev-b", passed: true, executionId: "exec-1" }, bound)
  assert.equal(result.ok, false)
  assert.match((result.ok ? "" : result.reason), /bound to revision/)
  const summary = summarizeVerification(
    "rev-b",
    [receipt({ revision: "rev-b", check: "tests", executionId: "exec-1" })],
    ["tests"],
    { "exec-1": bound },
  )
  assert.equal(summary.ok, false)
  assert.deepEqual(summary.unverified, ["tests"])
  assert.match(summary.reasons.join(" "), /unverified/)
})

test("a later valid execution supersedes earlier evidence for the same check", () => {
  const first = evidence({ executionId: "exec-1", at: 100 })
  const second = evidence({ executionId: "exec-2", at: 200 })
  const summary = summarizeVerification(
    "rev-a",
    [
      receipt({ revision: "rev-a", check: "tests", passed: false, at: 100, executionId: "exec-1" }),
      receipt({ revision: "rev-a", check: "tests", passed: true, at: 200, executionId: "exec-2" }),
      receipt({ revision: "rev-a", check: "typecheck", executionId: "exec-3" }),
    ],
    ["tests", "typecheck"],
    { "exec-1": first, "exec-2": second, "exec-3": evidence({ executionId: "exec-3" }) },
  )
  assert.equal(summary.ok, true)
  assert.equal(summary.results["tests"]?.at, 200)
})

test("passed receipts without evidence are unverified when executions are loaded", () => {
  const summary = summarizeVerification(
    "rev-a",
    [receipt({ revision: "rev-a", check: "tests" }), receipt({ revision: "rev-a", check: "typecheck" })],
    ["tests", "typecheck"],
    {},
  )
  assert.equal(summary.ok, false)
  assert.deepEqual(summary.unverified, ["tests", "typecheck"])
})

test("legacy receipts still verify when no execution map is supplied", () => {
  const summary = summarizeVerification("rev-a", [
    receipt({ revision: "rev-a", check: "tests" }),
    receipt({ revision: "rev-a", check: "typecheck" }),
  ])
  assert.equal(summary.ok, true)
})

test("execution evidence binds to one revision on first use", () => {
  const unbound = evidence({ executionId: "exec-1" })
  const bound = bindExecutionToRevision(unbound, "rev-a")
  assert.equal(bound.revision, "rev-a")
  assert.equal(unbound.revision, undefined)
  assert.equal(bindExecutionToRevision(bound, "rev-b").revision, "rev-a")
})

test("the observer ignores AndMar self-attestation and requires the stable id field", () => {
  assert.equal(buildExecutionEvidence({ id: "exec-1", tool: "andmar_record_receipt", status: "completed" }), undefined)
  assert.equal(isAndMarTool("andmar_verify_revision"), true)
  assert.equal(isAndMarTool("bash"), false)
  const observed = buildExecutionEvidence({ id: "exec-1", tool: "bash", status: "completed" }, 123)
  assert.equal(observed?.executionId, "exec-1")
  assert.equal(observed?.status, "completed")
  assert.equal(buildExecutionEvidence({ tool: "bash", status: "completed" }), undefined)
  assert.equal(isValidExecutionId(""), false)
  assert.equal(isValidExecutionId("exec-1"), true)
  assert.ok(executionEvidenceKey("a/b").startsWith(EXECUTION_EVIDENCE_PREFIX))
})

test("execute.after captures a real execution with minimal metadata only", () => {
  const observed = buildExecutionEvidence(
    {
      id: "exec-real-1",
      tool: "bash",
      sessionID: "ses-1",
      status: "completed",
      input: { command: "bun test", description: "run tests" },
      result: { output: "42 passed", content: "42 passed" },
    },
    1_700_000_000_100,
  )
  assert.ok(observed)
  assert.equal(observed?.executionId, "exec-real-1")
  assert.equal(observed?.tool, "bash")
  assert.equal(observed?.sessionID, "ses-1")
  assert.equal(observed?.status, "completed")
  assert.equal(observed?.command, "bun test")
  assert.equal(observed?.commandNormalized, "bun test")
  assert.ok(typeof observed?.outputDigest === "string" && observed.outputDigest.length === 64)
  // No full output is stored on evidence.
  assert.equal((observed as Record<string, unknown>)["output"], undefined)
  assert.equal((observed as Record<string, unknown>)["result"], undefined)
  assert.equal((observed as Record<string, unknown>)["content"], undefined)
})

test("command extraction stays simple and fails closed on unknown shapes", () => {
  assert.equal(extractCommand({ command: "bun test" }), "bun test")
  assert.equal(extractCommand("bun test"), "bun test")
  assert.equal(extractCommand({ cmd: "bun test" }), undefined)
  assert.equal(extractCommand({}), undefined)
  assert.equal(extractCommand(undefined), undefined)
  assert.equal(normalizeCommand("  bun   test\n--coverage  "), "bun test --coverage")
})

test("record_receipt resolves without an agent-supplied executionId", () => {
  const observed = buildExecutionEvidence(
    { id: "exec-1", tool: "bash", sessionID: "ses-1", status: "completed", input: { command: "bun test" } },
    100,
  )!
  // Resolution criteria carry no executionId: only session, command, result and revision.
  const criteria = { sessionID: "ses-1", command: "bun test", passed: true, revision: "rev-a" } as const
  assert.ok(!("executionId" in criteria))
  const resolved = resolveCompatibleExecution([observed], criteria)
  assert.equal(resolved.ok, true)
  assert.equal(resolved.ok ? resolved.execution.executionId : "", "exec-1")
})

test("successful same-session same-command execution produces a receipt", () => {
  const observed = buildExecutionEvidence(
    { id: "exec-1", tool: "bash", sessionID: "ses-1", status: "completed", input: { command: "bun test" } },
    100,
  )!
  const resolved = resolveCompatibleExecution([observed], {
    sessionID: "ses-1",
    command: "bun test",
    passed: true,
    revision: "rev-a",
  })
  assert.equal(resolved.ok, true)
  const summary = summarizeVerification(
    "rev-a",
    [receipt({ revision: "rev-a", check: "tests", executionId: "exec-1" })],
    ["tests"],
    { "exec-1": observed },
  )
  assert.equal(summary.ok, true)
})

test("nonexistent execution is rejected without creating a receipt", () => {
  const resolved = resolveCompatibleExecution([], {
    sessionID: "ses-1",
    command: "bun test",
    passed: true,
    revision: "rev-a",
  })
  assert.equal(resolved.ok, false)
  assert.match((resolved.ok ? "" : resolved.reason), /no observed OpenCode execution/)
})

test("failed execution cannot become a passing receipt via internal resolution", () => {
  const failed = buildExecutionEvidence(
    { id: "exec-fail", tool: "bash", sessionID: "ses-1", status: "error", input: { command: "bun test" } },
    100,
  )!
  assert.equal(failed.status, "error")
  const resolved = resolveCompatibleExecution([failed], {
    sessionID: "ses-1",
    command: "bun test",
    passed: true,
    revision: "rev-a",
  })
  assert.equal(resolved.ok, false)
  assert.match((resolved.ok ? "" : resolved.reason), /failed execution|cannot become|did not complete/)
  // The same failed execution can still back a failed receipt.
  const failedReceipt = resolveCompatibleExecution([failed], {
    sessionID: "ses-1",
    command: "bun test",
    passed: false,
    revision: "rev-a",
  })
  assert.equal(failedReceipt.ok, true)
})

test("execution from another session is rejected", () => {
  const foreign = buildExecutionEvidence(
    { id: "exec-1", tool: "bash", sessionID: "ses-other", status: "completed", input: { command: "bun test" } },
    100,
  )!
  const resolved = resolveCompatibleExecution([foreign], {
    sessionID: "ses-1",
    command: "bun test",
    passed: true,
    revision: "rev-a",
  })
  assert.equal(resolved.ok, false)
  assert.match((resolved.ok ? "" : resolved.reason), /another session|current session/)
})

test("different command is rejected even in the same session", () => {
  const observed = buildExecutionEvidence(
    { id: "exec-1", tool: "bash", sessionID: "ses-1", status: "completed", input: { command: "bun test" } },
    100,
  )!
  const resolved = resolveCompatibleExecution([observed], {
    sessionID: "ses-1",
    command: "bunx tsc --noEmit",
    passed: true,
    revision: "rev-a",
  })
  assert.equal(resolved.ok, false)
  assert.match((resolved.ok ? "" : resolved.reason), /command mismatch|no observed/)
})

test("whitespace-only representation differences still match, real differences fail closed", () => {
  const observed = buildExecutionEvidence(
    { id: "exec-1", tool: "bash", sessionID: "ses-1", status: "completed", input: { command: "bun   test" } },
    100,
  )!
  const same = resolveCompatibleExecution([observed], {
    sessionID: "ses-1",
    command: "bun test",
    passed: true,
    revision: "rev-a",
  })
  assert.equal(same.ok, true)
  const different = resolveCompatibleExecution([observed], {
    sessionID: "ses-1",
    command: "bun test --coverage",
    passed: true,
    revision: "rev-a",
  })
  assert.equal(different.ok, false)
})

test("resolved receipts stay revision-bound", () => {
  const observed = buildExecutionEvidence(
    { id: "exec-1", tool: "bash", sessionID: "ses-1", status: "completed", input: { command: "bun test" } },
    100,
  )!
  const bound = bindExecutionToRevision(observed, "rev-a")
  const stale = resolveCompatibleExecution([bound], {
    sessionID: "ses-1",
    command: "bun test",
    passed: true,
    revision: "rev-b",
  })
  assert.equal(stale.ok, false)
  assert.match((stale.ok ? "" : stale.reason), /bound to revision/)
})

test("verify_revision passes after valid observed checks", () => {
  const testsExec = buildExecutionEvidence(
    { id: "exec-tests", tool: "bash", sessionID: "ses-1", status: "completed", input: { command: "bun test" } },
    100,
  )!
  const typeExec = buildExecutionEvidence(
    { id: "exec-type", tool: "bash", sessionID: "ses-1", status: "completed", input: { command: "bunx tsc --noEmit" } },
    200,
  )!
  const testsResolved = resolveCompatibleExecution([testsExec], {
    sessionID: "ses-1",
    command: "bun test",
    passed: true,
    revision: "rev-a",
  })
  const typeResolved = resolveCompatibleExecution([typeExec], {
    sessionID: "ses-1",
    command: "bunx tsc --noEmit",
    passed: true,
    revision: "rev-a",
  })
  assert.equal(testsResolved.ok, true)
  assert.equal(typeResolved.ok, true)
  const summary = summarizeVerification(
    "rev-a",
    [
      receipt({ revision: "rev-a", check: "tests", executionId: "exec-tests" }),
      receipt({ revision: "rev-a", check: "typecheck", executionId: "exec-type" }),
    ],
    ["tests", "typecheck"],
    { "exec-tests": testsExec, "exec-type": typeExec },
  )
  assert.equal(summary.ok, true)
  assert.deepEqual(summary.missing, [])
  assert.deepEqual(summary.unverified, [])
})
