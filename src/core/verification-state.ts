import type { StateStore } from "./contracts.ts"
import type { VerificationGateStatus } from "./lifecycle.ts"

export type VerificationCheckName = "tests" | "lint" | "typecheck" | "build" | "custom"

export interface VerificationReceiptState {
  revision: string
  check: string
  passed: boolean
  at: number
  executionId?: string
}

export interface VerificationExecutionState {
  executionId: string
  status: string
  revision?: string
}

export interface VerificationStateSummary extends VerificationGateStatus {
  revision: string
  requiredChecks: string[]
  results: Record<string, { passed: boolean; at: number }>
}

export const VERIFICATION_RECEIPT_PREFIX = "verification/"
export const VERIFICATION_EVIDENCE_PREFIX = "verification-evidence/"

export function verificationReceiptKey(revision: string, check: string): string {
  return `${VERIFICATION_RECEIPT_PREFIX}${encodeURIComponent(revision)}/${check}`
}

export function verificationReceiptPrefix(revision: string): string {
  return `${VERIFICATION_RECEIPT_PREFIX}${encodeURIComponent(revision)}/`
}

export function verificationEvidenceKey(executionId: string): string {
  return `${VERIFICATION_EVIDENCE_PREFIX}${encodeURIComponent(executionId)}`
}

export function summarizeVerificationState(
  revision: string,
  receipts: readonly VerificationReceiptState[],
  requiredChecks: readonly string[],
  executionsById?:
    | Readonly<Record<string, VerificationExecutionState>>
    | ReadonlyMap<string, VerificationExecutionState>,
): VerificationStateSummary {
  const latest = new Map<string, VerificationReceiptState>()
  for (const receipt of receipts) {
    if (receipt.revision !== revision) continue
    const existing = latest.get(receipt.check)
    if (!existing || receipt.at >= existing.at) latest.set(receipt.check, receipt)
  }

  const lookup = (id: string): VerificationExecutionState | undefined => {
    if (!executionsById) return undefined
    if (executionsById instanceof Map) return executionsById.get(id)
    return (executionsById as Readonly<Record<string, VerificationExecutionState>>)[id]
  }

  const results: Record<string, { passed: boolean; at: number }> = {}
  const missing: string[] = []
  const failed: string[] = []
  const unverified: string[] = []
  for (const check of requiredChecks) {
    const receipt = latest.get(check)
    if (!receipt) {
      missing.push(check)
      continue
    }
    if (receipt.passed && executionsById) {
      const execution = receipt.executionId ? lookup(receipt.executionId) : undefined
      const bound = execution !== undefined && (execution.revision === undefined || execution.revision === revision)
      if (!receipt.executionId || !execution || execution.status !== "completed" || !bound) {
        unverified.push(check)
        continue
      }
    }
    results[check] = { passed: receipt.passed, at: receipt.at }
    if (!receipt.passed) failed.push(check)
  }

  const reasons: string[] = []
  if (missing.length > 0) reasons.push(`missing receipts for: ${missing.join(", ")}`)
  if (failed.length > 0) reasons.push(`failed checks: ${failed.join(", ")}`)
  if (unverified.length > 0) {
    reasons.push(`unverified receipts (no valid completed same-revision execution): ${unverified.join(", ")}`)
  }

  return {
    ok: reasons.length === 0,
    revision,
    requiredChecks: [...requiredChecks],
    results,
    missing,
    failed,
    unverified,
    reasons,
  }
}

/**
 * Read-only shared contract for consumers of verification truth.
 * Verification owns these keys; other capabilities may consume them through
 * this helper but must never write them or reinterpret their storage shape.
 */
export async function readVerificationState(
  state: StateStore,
  revision: string,
  requiredChecks: readonly string[],
): Promise<VerificationStateSummary> {
  const [receiptEntries, evidenceEntries] = await Promise.all([
    state.scan<VerificationReceiptState>(verificationReceiptPrefix(revision)),
    state.scan<VerificationExecutionState>(VERIFICATION_EVIDENCE_PREFIX),
  ])
  const evidence = new Map<string, VerificationExecutionState>()
  for (const entry of evidenceEntries) {
    if (entry.value && typeof entry.value.executionId === "string") {
      evidence.set(entry.value.executionId, entry.value)
    }
  }
  return summarizeVerificationState(
    revision,
    receiptEntries.map((entry) => entry.value),
    requiredChecks,
    evidence,
  )
}
