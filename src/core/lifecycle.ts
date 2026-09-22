import type { ChangeKind, DocumentationRule, CompletionEvidence } from "./contracts.ts"
import type { RequirementGateResult, ReviewGateResult } from "./task-contract.ts"
import { matchesAny } from "./glob.ts"

export interface DocumentationImpact {
  status: "clean" | "stale" | "not-applicable"
  affectedRuleIDs: string[]
  expectedDocs: string[]
}

export function analyzeDocumentationImpact(changedPaths: string[], rules: DocumentationRule[]): DocumentationImpact {
  const affected = rules.filter((rule) => changedPaths.some((path) => matchesAny(rule.code, path)))
  if (affected.length === 0) return { status: "not-applicable", affectedRuleIDs: [], expectedDocs: [] }

  const expectedDocs = [...new Set(affected.flatMap((rule) => rule.docs))]
  const docsChanged = affected.every((rule) =>
    changedPaths.some((path) => matchesAny(rule.docs, path)),
  )

  return {
    status: docsChanged ? "clean" : "stale",
    affectedRuleIDs: affected.map((rule) => rule.id),
    expectedDocs,
  }
}

export type VersionImpact = "none" | "patch" | "minor" | "major"

export function inferVersionImpact(input: {
  kind: ChangeKind
  touchesPublicSurface: boolean
  breaking?: boolean
}): VersionImpact {
  if (!input.touchesPublicSurface) return "none"
  if (input.breaking) return "major"
  if (input.kind === "feature") return "minor"
  if (["bugfix", "refactor", "security", "migration"].includes(input.kind)) return "patch"
  return "none"
}

export function evaluateCompletion(currentRevision: string, evidence: CompletionEvidence): {
  ok: boolean
  reasons: string[]
} {
  const reasons: string[] = []
  if (evidence.revision !== currentRevision) reasons.push("verification evidence is stale for the current revision")
  if (!evidence.testsPassed) reasons.push("tests have not passed")
  if (evidence.reviewPassed === false) reasons.push("review did not pass")
  if (evidence.docsStatus === "stale") reasons.push("documentation is potentially stale")
  if (evidence.versionStatus === "required") reasons.push("version/changelog update is still required")
  return { ok: reasons.length === 0, reasons }
}

export interface VerificationGateStatus {
  ok: boolean
  missing: string[]
  failed: string[]
  unverified: string[]
  reasons: string[]
}

/**
 * Completion gate V2: exact-revision verification plus Task Contract
 * requirement gate plus independent review gate, then docs/version
 * obligations. Order is fixed:
 *
 * ```text
 * 1. revision verification
 * 2. Task Contract gate (pending/blocked/evidence/staleness)
 * 3. required independent review (fresh, current revision, approved)
 * 4. docs/version obligations
 * 5. completion
 * ```
 *
 * `contractGate`/`reviewGate` are undefined when no Task Contract exists
 * for the session (trivial tasks): the gate then behaves exactly like
 * `evaluateCompletionWithVerification`.
 */
export function evaluateCompletionV2(
  currentRevision: string,
  evidence: CompletionEvidence,
  verification: VerificationGateStatus,
  requiredChecks: readonly string[] = ["tests", "typecheck"],
  contractGate?: RequirementGateResult | undefined,
  reviewGate?: ReviewGateResult | undefined,
): { ok: boolean; reasons: string[] } {
  const base = evaluateCompletionWithVerification(currentRevision, evidence, verification, requiredChecks)
  const reasons = [...base.reasons]
  if (contractGate && !contractGate.ok) {
    for (const reason of contractGate.reasons) reasons.push(`task contract: ${reason}`)
  }
  if (reviewGate && !reviewGate.ok) {
    for (const reason of reviewGate.reasons) reasons.push(`independent review: ${reason}`)
  }
  return { ok: reasons.length === 0, reasons }
}

/**
 * Completion gate with required-verification invariant.
 *
 * When `requiredChecks` is non-empty, stored verification for the exact
 * current revision must also be satisfied: a manual `testsPassed: true`
 * flag alone can never represent the revision as formally verified.
 * Pass `requiredChecks: []` only for tasks that genuinely require no
 * checks (proportional escape hatch, explicit and observable).
 */
export function evaluateCompletionWithVerification(
  currentRevision: string,
  evidence: CompletionEvidence,
  verification: VerificationGateStatus,
  requiredChecks: readonly string[] = ["tests", "typecheck"],
): { ok: boolean; reasons: string[] } {
  const base = evaluateCompletion(currentRevision, evidence)
  if (requiredChecks.length === 0) return base
  if (verification.ok) return base
  const detail = verification.reasons.length > 0 ? verification.reasons.join("; ") : "required verification is incomplete"
  return {
    ok: false,
    reasons: [
      ...base.reasons,
      `required verification (${requiredChecks.join(", ")}) is not satisfied for revision "${currentRevision}": ${detail}`,
    ],
  }
}
