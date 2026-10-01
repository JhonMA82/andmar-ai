// Observed execution evidence (pure helpers, no OpenCode imports).
//
// Verification flow:
//
// ```text
// native OpenCode shell/tools
//         ↓
// tool.execute.after (authoritative source)
//         ↓
// ObservedExecution (executionId, sessionID, command, result, timestamp...)
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
//   same-session, same-command observed execution whose observed process
//   outcome is successful (exit code 0 when observable, no signal, no
//   timeout).
// - The agent never provides `executionId`; that identifier stays internal for
//   audit. `andmar_record_receipt` resolves it from (sessionID, normalized
//   command).
// - Evidence is bound to one working-state revision on first use and can
//   never satisfy a different revision.
// - Only minimal metadata is stored; full command output is never stored
//   (only an optional digest). Full output stays truncated on the receipt
//   itself when the agent supplies it.

import { createHash } from "node:crypto"
import {
  isObservableSuccess,
  VERIFICATION_EVIDENCE_PREFIX,
  verificationEvidenceKey,
} from "../../core/verification-state.ts"

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
  /** Observed process exit code when the tool exposes it; never inferred. */
  exitCode?: number
  /** Observed termination signal when the tool exposes it; never inferred. */
  exitSignal?: string
  /** Observed timeout when the tool exposes it; never inferred. */
  timedOut?: boolean
  /** Optional sha256 digest of the observed result/error (no output stored). */
  outputDigest?: string
}

export const EXECUTION_EVIDENCE_PREFIX = VERIFICATION_EVIDENCE_PREFIX

export const MAX_EXECUTION_ID_CHARS = 200

export function executionEvidenceKey(executionId: string): string {
  return verificationEvidenceKey(executionId)
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

/**
 * Read the observed process exit code from a tool result.
 *
 * OpenCode's native shell tool reports the observed process outcome in
 * `Tool.Result.metadata` (see `Tool.Metadata` in `@opencode/schema/tool`) as
 * `{ output, truncated, exit?, signal?, timeout? }`. `metadata.exit` is the
 * field OpenCode actually sets, so it is the primary source; `metadata.exitCode`
 * and a top-level `exitCode`/`exit` are accepted as equivalent shapes from other
 * or older tooling.
 *
 * Only a finite integer is accepted: a missing or malformed value stays
 * `undefined` and is never invented, so evidence keeps its minimal-metadata
 * contract (CON-2).
 */
export function extractExitCode(result: unknown): number | undefined {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return undefined
  const record = result as Record<string, unknown>
  const metadata = record.metadata as Record<string, unknown> | undefined
  const candidates = [record.exitCode, metadata?.exitCode, record.exit, metadata?.exit]
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isInteger(candidate)) return candidate
  }
  return undefined
}

/**
 * Read the observed termination signals that mean the process did not finish
 * normally even when the tool call itself completed: a termination signal
 * (`SIGKILL`) or a timeout. Both come from the same `Tool.Result.metadata`
 * shape as the exit code. Nothing is inferred; unexposed values stay `undefined`.
 */
export function extractTermination(result: unknown): { exitSignal?: string; timedOut?: boolean } {
  const outcome: { exitSignal?: string; timedOut?: boolean } = {}
  if (result === null || typeof result !== "object" || Array.isArray(result)) return outcome
  const metadata = (result as Record<string, unknown>).metadata as Record<string, unknown> | undefined
  if (metadata === undefined) return outcome
  const signal = metadata.signal
  if (typeof signal === "string" && signal.trim() !== "") outcome.exitSignal = signal.trim()
  if (metadata.timeout === true) outcome.timedOut = true
  return outcome
}

/**
 * True when an observed execution can legitimately back a `passed: true`
 * receipt: the tool completed **and** the process, when its outcome is
 * observable, finished successfully.
 *
 * A completed tool call is not a successful check. OpenCode reports a failing
 * process as a completed call carrying a non-zero `metadata.exit`, so both the
 * status and the observed process outcome are required.
 */
export function isSuccessfulExecution(execution: ExecutionEvidence): boolean {
  return isObservableSuccess(execution)
}

/** Deterministic refusal reason for a non-successful observed execution. */
export function unsuccessfulExecutionReason(execution: ExecutionEvidence): string {
  if (execution.status !== "completed") {
    return `execution "${execution.executionId}" did not complete successfully (status "${execution.status}"); a failed execution cannot become a passed receipt`
  }
  if (execution.exitSignal !== undefined) {
    return `execution "${execution.executionId}" was terminated by signal "${execution.exitSignal}"; a signalled run cannot become a passed receipt`
  }
  if (execution.timedOut) {
    return `execution "${execution.executionId}" timed out; a timed-out run cannot become a passed receipt`
  }
  return `execution "${execution.executionId}" exited with code ${execution.exitCode}; a non-zero exit cannot become a passed receipt`
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
  tool?: unknown
  status?: unknown
  sessionID?: unknown
  /** Official stable field: observed tool arguments. */
  input?: unknown
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
 *   id: Tool.CallID,      // the stable call id
 *   input: unknown,       // observed arguments (bash: { command })
 *   status: "completed" | "error",
 *   result?: Tool.Result, // completed (shell: metadata.{output,truncated,exit?,signal?,timeout?})
 *   error?: Tool.Error,   // error
 * }
 * ```
 *
 * `event.id` is the only stable call identifier on this hook.
 * A `status: "completed"` tool call is not by itself a successful check:
 * a shell command that exits non-zero still completes as a tool call, so the
 * observed process outcome (`metadata.exit`, plus `signal`/`timeout` for a
 * process that never finished) is stored as minimal metadata and gates
 * `passed: true`. Only session, internal call id, tool, command (+ normalized),
 * status, observed process outcome, timestamp and an optional output digest
 * are persisted. Full inputs/outputs are never persisted.
 */
export function buildExecutionEvidence(event: HookEventLike, now: number = Date.now()): ExecutionEvidence | undefined {
  const rawId = event.id
  if (!isValidExecutionId(rawId)) return undefined
  if (isAndMarTool(event.tool) || event.tool === "execute") return undefined
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
  const command = extractCommand(event.input)
  if (command !== undefined) {
    evidence.command = command
    evidence.commandNormalized = normalizeCommand(command)
  }
  if (status === "completed") {
    const exitCode = extractExitCode(event.result)
    if (exitCode !== undefined) evidence.exitCode = exitCode
    const termination = extractTermination(event.result)
    if (termination.exitSignal !== undefined) evidence.exitSignal = termination.exitSignal
    if (termination.timedOut !== undefined) evidence.timedOut = termination.timedOut
  }
  const digest = digestValue(status === "completed" ? event.result : event.error)
  if (digest !== undefined) {
    evidence.outputDigest = digest
  }
  return evidence
}

/** Stable collision suffix; keeps native IDs and existing receipts compatible. */
export function collisionExecutionId(nativeId: string, ordinal: number): string {
  return `observed-${createHash("sha256").update(nativeId).digest("hex")}-${ordinal}`
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
  if (criteria.passed && !isSuccessfulExecution(latest)) {
    return { ok: false, reason: unsuccessfulExecutionReason(latest) }
  }
  return { ok: true, execution: latest }
}

/** Bind an unbound execution to a revision on first successful use. */
export function bindExecutionToRevision(execution: ExecutionEvidence, revision: string): ExecutionEvidence {
  if (execution.revision !== undefined) return execution
  return { ...execution, revision }
}
