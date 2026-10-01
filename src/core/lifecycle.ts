import type { ChangeKind, DocumentationRule } from "./contracts.ts"
import type { RequirementGateResult } from "./task-contract.ts"
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

export interface VerificationGateStatus {
  ok: boolean
  missing: string[]
  failed: string[]
  unverified: string[]
  reasons: string[]
}

/**
 * Documentation and version obligations reported by the caller. They are the
 * only completion inputs that cannot be derived from stored state.
 */
export interface CompletionObligations {
  docsStatus: "clean" | "updated" | "stale" | "not-applicable"
  versionStatus: "clean" | "updated" | "required" | "not-applicable"
}

export interface CompletionResult {
  ok: boolean
  reasons: string[]
}

/**
 * The single completion boundary, enforced in fixed order:
 *
 * ```text
 * 1. exact-revision stored Verification for the required checks
 * 2. Task Contract requirements (pending/blocked/evidence/staleness)
 * 3. docs and version obligations
 * ```
 *
 * Exact-revision identity is not a caller claim: `verification` is already
 * summarized for `currentRevision` and `contractGate` is already evaluated
 * against `currentRevision`, so stale evidence cannot satisfy completion. With
 * non-empty `requiredChecks`, missing, failed or unverified receipts fail
 * closed. `requiredChecks: []` is the explicit proportional escape hatch for
 * tasks that genuinely require no checks.
 *
 * `contractGate` is undefined when no Task Contract exists for the session
 * (trivial tasks). No second LLM judges completion.
 */
export function evaluateCompletion(
  currentRevision: string,
  obligations: CompletionObligations,
  verification: VerificationGateStatus,
  requiredChecks: readonly string[],
  contractGate?: RequirementGateResult | undefined,
): CompletionResult {
  const reasons: string[] = []
  if (requiredChecks.length > 0 && !verification.ok) {
    const detail =
      verification.reasons.length > 0 ? verification.reasons.join("; ") : "required verification is incomplete"
    reasons.push(
      `required verification (${requiredChecks.join(", ")}) is not satisfied for revision "${currentRevision}": ${detail}`,
    )
  }
  if (contractGate && !contractGate.ok) {
    for (const reason of contractGate.reasons) reasons.push(`task contract: ${reason}`)
  }
  if (obligations.docsStatus === "stale") reasons.push("documentation is potentially stale")
  if (obligations.versionStatus === "required") reasons.push("version/changelog update is still required")
  return { ok: reasons.length === 0, reasons }
}
