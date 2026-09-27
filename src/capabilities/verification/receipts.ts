// Revision-bound verification receipts (pure helpers, no OpenCode imports).
//
// A receipt binds one check outcome to an exact revision. Any revision change
// invalidates earlier evidence: callers must re-run the checks and record new
// receipts instead of reusing old ones.

import type { ExecutionEvidence } from "./evidence.ts"
import {
  summarizeVerificationState,
  verificationReceiptKey,
  verificationReceiptPrefix,
  type VerificationCheckName,
} from "../../core/verification-state.ts"

export type VerificationCheck = VerificationCheckName

export interface VerificationReceipt {
  revision: string
  check: VerificationCheck
  passed: boolean
  command?: string
  output?: string
  at: number
  sessionID?: string
  /**
   * Observed OpenCode execution that produced this outcome.
   * Required for `passed: true` when verification is evidence-aware;
   * references `verification-evidence/<executionId>`.
   */
  executionId?: string
}

export interface VerificationSummary {
  ok: boolean
  revision: string
  requiredChecks: VerificationCheck[]
  results: Record<string, { passed: boolean; at: number }>
  missing: string[]
  failed: string[]
  /** Passed receipts without valid completed same-revision execution evidence. */
  unverified: string[]
  reasons: string[]
}

export const DEFAULT_REQUIRED_CHECKS: VerificationCheck[] = ["tests", "typecheck"]

export const MAX_OUTPUT_CHARS = 2_000

export function truncateOutput(output: string, max: number = MAX_OUTPUT_CHARS): string {
  if (output.length <= max) return output
  return `${output.slice(0, max)}\n…[truncated by AndMar AI]`
}

export function receiptKey(revision: string, check: string): string {
  return verificationReceiptKey(revision, check)
}

export function receiptPrefix(revision: string): string {
  return verificationReceiptPrefix(revision)
}

export function summarizeVerification(
  revision: string,
  receipts: VerificationReceipt[],
  requiredChecks: VerificationCheck[] = DEFAULT_REQUIRED_CHECKS,
  executionsById?: Readonly<Record<string, ExecutionEvidence>> | ReadonlyMap<string, ExecutionEvidence>,
): VerificationSummary {
  return summarizeVerificationState(revision, receipts, requiredChecks, executionsById) as VerificationSummary
}
