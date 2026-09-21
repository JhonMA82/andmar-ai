// Observed execution evidence (pure helpers, no OpenCode imports).
//
// Verification hardening for v0.3.1:
//
// ```text
// OpenCode executes check (native shell/tools)
//         ↓
// AndMar observes the real result via ctx.tool.hook("execute.after", ...)
//         ↓
// minimal execution evidence is stored (metadata only, no full output)
//         ↓
// andmar_record_receipt references that evidence by executionId
//         ↓
// andmar_verify_revision accepts or rejects based on bound evidence
// ```
//
// Design constraints:
// - AndMar never runs subprocesses itself; observation only.
// - `passed: true` alone is never evidence; it requires a completed,
//   same-revision observed execution.
// - Evidence is bound to one working-state revision on first use and can
//   never satisfy a different revision.
// - Only minimal metadata is stored; full command output is truncated on
//   the receipt itself and never duplicated in evidence.

export interface ExecutionEvidence {
  executionId: string
  tool: string
  status: "completed" | "error"
  sessionID?: string
  at: number
  /** Working-state revision this execution was first bound to, if any. */
  revision?: string
}

export const EXECUTION_EVIDENCE_PREFIX = "verification-evidence/"

export const MAX_EXECUTION_ID_CHARS = 200

export function executionEvidenceKey(executionId: string): string {
  return `${EXECUTION_EVIDENCE_PREFIX}${encodeURIComponent(executionId)}`
}

export function isValidExecutionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_EXECUTION_ID_CHARS
  )
}

/** AndMar's own primitives must never serve as check-execution evidence. */
export function isAndMarTool(tool: unknown): boolean {
  if (typeof tool !== "string") return false
  const name = tool.trim().toLowerCase()
  return name === "andmar" || /^andmar[_/:.-]/.test(name)
}

interface HookEventLike {
  id?: unknown
  callID?: unknown
  tool?: unknown
  status?: unknown
  sessionID?: unknown
}

/**
 * Map one `execute.after` hook event to minimal evidence.
 * Returns `undefined` when the event cannot serve as check evidence
 * (missing id, or an AndMar-owned tool that would be self-attestation).
 * Uses the official stable `event.id` field; `event.callID` is only a
 * legacy fallback and must not be relied on.
 */
export function buildExecutionEvidence(event: HookEventLike, now: number = Date.now()): ExecutionEvidence | undefined {
  const rawId = typeof event.id === "string" && event.id.trim() !== "" ? event.id : event.callID
  if (!isValidExecutionId(rawId)) return undefined
  if (isAndMarTool(event.tool)) return undefined
  const tool = typeof event.tool === "string" && event.tool.trim() !== "" ? event.tool : "unknown"
  const status = event.status === "completed" ? "completed" : "error"
  const evidence: ExecutionEvidence = {
    executionId: rawId,
    tool,
    status,
    at: now,
  }
  if (typeof event.sessionID === "string" && event.sessionID !== "") {
    evidence.sessionID = event.sessionID
  }
  return evidence
}

export interface ReceiptEvidenceInput {
  revision: string
  passed: boolean
  executionId?: string
}

/**
 * Decide whether a receipt may reference an observed execution.
 * Pure and deterministic; storage lookups happen in the caller.
 */
export function validateReceiptEvidence(
  input: ReceiptEvidenceInput,
  execution: ExecutionEvidence | undefined,
): { ok: true } | { ok: false; reason: string } {
  const executionId = input.executionId?.trim() ?? ""
  if (!input.passed) {
    if (executionId === "") return { ok: true }
    if (!isValidExecutionId(input.executionId)) {
      return { ok: false, reason: "executionId is not a valid non-empty id" }
    }
    if (!execution) {
      return { ok: false, reason: `unknown executionId "${executionId}": no observed OpenCode execution` }
    }
    if (execution.revision !== undefined && execution.revision !== input.revision) {
      return {
        ok: false,
        reason: `execution "${executionId}" is bound to revision "${execution.revision}" and cannot satisfy revision "${input.revision}"`,
      }
    }
    return { ok: true }
  }

  if (!isValidExecutionId(input.executionId)) {
    return {
      ok: false,
      reason: "passed receipts require executionId: record only the executionId observed via OpenCode execute.after for the command that just ran",
    }
  }
  if (!execution) {
    return {
      ok: false,
      reason: `unknown executionId "${executionId}": no observed OpenCode execution; run the check first through native OpenCode shell/tools`,
    }
  }
  if (execution.status !== "completed") {
    return {
      ok: false,
      reason: `execution "${executionId}" did not complete successfully (status "${execution.status}"); a failed execution cannot become a passed receipt`,
    }
  }
  if (execution.revision !== undefined && execution.revision !== input.revision) {
    return {
      ok: false,
      reason: `execution "${executionId}" is bound to revision "${execution.revision}" and cannot satisfy revision "${input.revision}"; re-run the check on the current working state`,
    }
  }
  return { ok: true }
}

/** Bind an unbound execution to a revision on first successful use. */
export function bindExecutionToRevision(execution: ExecutionEvidence, revision: string): ExecutionEvidence {
  if (execution.revision !== undefined) return execution
  return { ...execution, revision }
}
