// Observed execution evidence (pure helpers, no OpenCode imports).
//
// Verification flow (v0.4.x):
//
// ```text
// native OpenCode shell/tools
//         ↓
// tool.execute.after (authoritative source)
//         ↓
// ObservedExecution (sessionID, callID, command, result, timestamp...)
//         ↓
// andmar_record_receipt (check, revision, command)
//         ↓
// resolve internally a compatible observed execution
//         ↓
// receipt bound to real evidence
// ```
//
// Design constraints:
// - AndMar never runs subprocesses itself; observation only.
// - `passed: true` alone is never evidence; it requires a completed,
//   same-session, same-command observed execution.
// - The agent never provides `executionId`/`callID`; that identifier stays
//   internal for audit. `andmar_record_receipt` resolves it from
//   (sessionID, normalized command).
// - Evidence is bound to one working-state revision on first use and can
//   never satisfy a different revision.
// - Only minimal metadata is stored; full command output is never stored
//   (only an optional digest). Full output stays truncated on the receipt
//   itself when the agent supplies it.

import { createHash } from "node:crypto"

export interface ExecutionEvidence {
  executionId: string
  tool: string
  status: "completed" | "error"
  sessionID?: string
  at: number
  /** Working-state revision this execution was first bound to, if any. */
  revision?: string
  /** Raw command extracted from the observed tool input, when available. */
  command?: string
  /** Deterministic normalized command used for matching. */
  commandNormalized?: string
  /** Optional sha256 digest of the observed result/error (no output stored). */
  outputDigest?: string
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

/**
 * Deterministic command normalization for matching.
 * Trims and collapses all whitespace runs to a single space.
 * No shell parsing: different quoting, env prefixes or shell constructs
 * that change the string fail closed and must be re-run with the exact
 * same command representation.
 */
export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ")
}

/**
 * Extract the executed command from an `execute.after` input payload.
 * Supports the observed OpenCode bash shape (`{ command: string }`) and
 * raw string inputs. Any other shape returns `undefined` (fail closed)
 * so new tool shapes can be observed before adding heuristics.
 */
export function extractCommand(input: unknown): string | undefined {
  if (typeof input === "string") {
    const trimmed = input.trim()
    return trimmed === "" ? undefined : trimmed
  }
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>
    if (typeof record.command === "string" && record.command.trim() !== "") {
      return record.command.trim()
    }
    return undefined
  }
  return undefined
}

function digestValue(value: unknown): string | undefined {
  if (value === undefined) return undefined
  try {
    const json = JSON.stringify(value) ?? String(value)
    return createHash("sha256").update(json).digest("hex")
  } catch {
    try {
      return createHash("sha256").update(String(value)).digest("hex")
    } catch {
      return undefined
    }
  }
}

interface HookEventLike {
  id?: unknown
  callID?: unknown
  tool?: unknown
  status?: unknown
  sessionID?: unknown
  /** Official stable field: observed tool arguments. */
  input?: unknown
  /** Legacy/alias some callers use for arguments; accepted for robustness. */
  args?: unknown
  result?: unknown
  error?: unknown
}

/**
 * Map one `execute.after` hook event to minimal evidence.
 * Returns `undefined` when the event cannot serve as check evidence
 * (missing id, or an AndMar-owned tool that would be self-attestation).
 *
 * Verified against `@opencode/plugin@2.0.4` (`dist/promise/tool.d.ts`):
 *
 * ```text
 * {
 *   tool: string,
 *   sessionID: Session.ID,
 *   agent: Agent.ID,
 *   messageID: SessionMessage.ID,
 *   id: Tool.CallID,      // stable call id — NOT `callID`
 *   input: unknown,       // observed arguments (bash: { command })
 *   status: "completed" | "error",
 *   result?: Tool.Result, // completed
 *   error?: Tool.Error,   // error
 * }
 * ```
 *
 * `event.callID` is only a legacy fallback and must not be relied on.
 * Only minimal metadata is stored: session, internal call id, tool,
 * command (+ normalized), status, timestamp and an optional output
 * digest. Full inputs/outputs are never persisted.
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
  const rawInput = event.input !== undefined ? event.input : event.args
  const command = extractCommand(rawInput)
  if (command !== undefined) {
    evidence.command = command
    evidence.commandNormalized = normalizeCommand(command)
  }
  const digest = digestValue(status === "completed" ? event.result : event.error)
  if (digest !== undefined) {
    evidence.outputDigest = digest
  }
  return evidence
}

export interface ReceiptEvidenceInput {
  revision: string
  passed: boolean
  executionId?: string
}

/**
 * Legacy executionId-based validation (kept for `verify_revision`
 * linkage checks and backward-compat unit coverage).
 * New receipts resolve via `resolveCompatibleExecution` instead of
 * requiring the agent to supply `executionId`.
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

export interface ReceiptResolutionCriteria {
  sessionID: string
  command: string
  passed: boolean
  revision: string
}

/**
 * Resolve the observed execution that backs a receipt request.
 * Pure and deterministic: same-session, same normalized command,
 * revision-compatible, most recent wins. Fails closed on any mismatch.
 */
export function resolveCompatibleExecution(
  evidences: readonly ExecutionEvidence[],
  criteria: ReceiptResolutionCriteria,
): { ok: true; execution: ExecutionEvidence } | { ok: false; reason: string } {
  const sessionID = criteria.sessionID.trim()
  if (sessionID === "") {
    return { ok: false, reason: "cannot resolve observed execution without the current sessionID" }
  }
  if (typeof criteria.command !== "string" || criteria.command.trim() === "") {
    return {
      ok: false,
      reason: "command is required to resolve observed execution: run the check first through native OpenCode shell/tools, then record it with the exact same command",
    }
  }
  const wanted = normalizeCommand(criteria.command)

  const sessionMatches = evidences.filter((item) => item.sessionID === sessionID)
  if (sessionMatches.length === 0) {
    const foreign = evidences.filter((item) => item.sessionID !== undefined && item.sessionID !== sessionID)
    if (foreign.length > 0) {
      return {
        ok: false,
        reason: `no observed OpenCode execution in current session "${sessionID}" for command "${wanted}"; executions from another session cannot satisfy this receipt; run the check in the current session first`,
      }
    }
    return {
      ok: false,
      reason: `no observed OpenCode execution in current session "${sessionID}" for command "${wanted}"; run the check first through native OpenCode shell/tools`,
    }
  }

  const commandMatches = sessionMatches.filter((item) => item.commandNormalized === wanted)
  if (commandMatches.length === 0) {
    return {
      ok: false,
      reason: `no observed OpenCode execution in current session for command "${wanted}"; command mismatch: run the exact command first, then record it with the same representation`,
    }
  }

  const revisionMatches = commandMatches.filter(
    (item) => item.revision === undefined || item.revision === criteria.revision,
  )
  if (revisionMatches.length === 0) {
    const bound = commandMatches.find((item) => item.revision !== undefined)
    return {
      ok: false,
      reason: bound
        ? `observed execution for command "${wanted}" is bound to revision "${bound.revision}" and cannot satisfy revision "${criteria.revision}"; re-run the check on the current working state`
        : `no revision-compatible observed execution for command "${wanted}" and revision "${criteria.revision}"; re-run the check on the current working state`,
    }
  }

  const latest = [...revisionMatches].sort((a, b) => b.at - a.at)[0]!
  if (criteria.passed && latest.status !== "completed") {
    return {
      ok: false,
      reason: `observed execution "${latest.executionId}" for command "${wanted}" did not complete successfully (status "${latest.status}"); a failed execution cannot become a passed receipt`,
    }
  }
  return { ok: true, execution: latest }
}

/** Bind an unbound execution to a revision on first successful use. */
export function bindExecutionToRevision(execution: ExecutionEvidence, revision: string): ExecutionEvidence {
  if (execution.revision !== undefined) return execution
  return { ...execution, revision }
}
