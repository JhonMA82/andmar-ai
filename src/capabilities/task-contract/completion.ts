import type { RequirementGateResult } from "./contract.ts"

import type { VerificationGateStatus } from "../../core/verification-state.ts"
export type { VerificationGateStatus } from "../../core/verification-state.ts"

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
