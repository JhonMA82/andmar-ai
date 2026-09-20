// Revision-bound verification receipts (pure helpers, no OpenCode imports).
//
// A receipt binds one check outcome to an exact revision. Any revision change
// invalidates earlier evidence: callers must re-run the checks and record new
// receipts instead of reusing old ones.

export type VerificationCheck = "tests" | "lint" | "typecheck" | "build" | "custom"

export interface VerificationReceipt {
  revision: string
  check: VerificationCheck
  passed: boolean
  command?: string
  output?: string
  at: number
  sessionID?: string
}

export interface VerificationSummary {
  ok: boolean
  revision: string
  requiredChecks: VerificationCheck[]
  results: Record<string, { passed: boolean; at: number }>
  missing: string[]
  failed: string[]
  reasons: string[]
}

export const DEFAULT_REQUIRED_CHECKS: VerificationCheck[] = ["tests", "typecheck"]

export const MAX_OUTPUT_CHARS = 2_000

export function truncateOutput(output: string, max: number = MAX_OUTPUT_CHARS): string {
  if (output.length <= max) return output
  return `${output.slice(0, max)}\n…[truncated by AndMar AI]`
}

export function receiptKey(revision: string, check: string): string {
  return `verification/${encodeURIComponent(revision)}/${check}`
}

export function receiptPrefix(revision: string): string {
  return `verification/${encodeURIComponent(revision)}/`
}

export function summarizeVerification(
  revision: string,
  receipts: VerificationReceipt[],
  requiredChecks: VerificationCheck[] = DEFAULT_REQUIRED_CHECKS,
): VerificationSummary {
  const latest = new Map<string, VerificationReceipt>()
  for (const receipt of receipts) {
    if (receipt.revision !== revision) continue
    latest.set(receipt.check, receipt)
  }

  const results: Record<string, { passed: boolean; at: number }> = {}
  const missing: string[] = []
  const failed: string[] = []
  for (const check of requiredChecks) {
    const receipt = latest.get(check)
    if (!receipt) {
      missing.push(check)
      continue
    }
    results[check] = { passed: receipt.passed, at: receipt.at }
    if (!receipt.passed) failed.push(check)
  }

  const reasons: string[] = []
  if (missing.length > 0) reasons.push(`missing receipts for: ${missing.join(", ")}`)
  if (failed.length > 0) reasons.push(`failed checks: ${failed.join(", ")}`)
  return { ok: reasons.length === 0, revision, requiredChecks: [...requiredChecks], results, missing, failed, reasons }
}
