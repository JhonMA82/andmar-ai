import type { Capability, StateStore } from "../../core/contracts.ts"
import {
  DEFAULT_REQUIRED_CHECKS,
  receiptKey,
  receiptPrefix,
  summarizeVerification,
  truncateOutput,
  type VerificationCheck,
  type VerificationReceipt,
} from "./receipts.ts"
import {
  bindExecutionToRevision,
  buildExecutionEvidence,
  EXECUTION_EVIDENCE_PREFIX,
  executionEvidenceKey,
  resolveCompatibleExecution,
  type ExecutionEvidence,
} from "./evidence.ts"
import { detectProjectChecks } from "./detect.ts"

const CHECKS = ["tests", "lint", "typecheck", "build", "custom"] as const

function sessionIDFrom(toolContext: any): string | undefined {
  return toolContext?.sessionID ?? toolContext?.session?.id ?? toolContext?.metadata?.sessionID
}

function refusalCategory(reason: string): string {
  if (reason.includes("another session") || reason.includes("current session")) return "session-mismatch"
  if (reason.includes("command mismatch")) return "command-mismatch"
  if (reason.includes("did not complete") || reason.includes("failed execution")) return "failed-execution"
  if (reason.includes("bound to revision") || reason.includes("revision-compatible")) return "revision-mismatch"
  return "no-compatible-execution"
}

async function readReceipts(state: StateStore, revision: string): Promise<VerificationReceipt[]> {
  const entries = await state.scan<VerificationReceipt>(receiptPrefix(revision))
  return entries.map((entry) => entry.value)
}

async function readEvidenceMap(state: StateStore): Promise<Record<string, ExecutionEvidence>> {
  const entries = await state.scan<ExecutionEvidence>(EXECUTION_EVIDENCE_PREFIX)
  const map: Record<string, ExecutionEvidence> = {}
  for (const entry of entries) map[entry.value.executionId] = entry.value
  return map
}

async function readEvidenceList(state: StateStore): Promise<ExecutionEvidence[]> {
  const entries = await state.scan<ExecutionEvidence>(EXECUTION_EVIDENCE_PREFIX)
  return entries.map((entry) => entry.value)
}

export const verificationCapability: Capability = {
  id: "verification",
  version: 3,
  description: "Revision-bound verification receipts resolved internally from observed OpenCode execution evidence.",
  async setup({ ctx, state, observability }) {
    const disposers: Array<() => void> = []

    const registration = await ctx.tool.transform((editor: any) => {
      editor.namespace({ name: "andmar", description: "AndMar AI harness primitives" })
      editor.add({
        name: "record_receipt",
        description:
          "Record the outcome of one verification check for an exact revision. Run the command first through native OpenCode shell/tools (this tool never runs commands itself), then record it here with the same revision, check, passed flag and exact command. AndMar resolves the observed execution internally by current session plus normalized command; no executionId is needed. Passed receipts require a completed same-session same-command execution; failed executions can never become passed receipts.",
        input: {
          type: "object",
          properties: {
            revision: { type: "string", minLength: 1, maxLength: 200 },
            check: { type: "string", enum: [...CHECKS] },
            passed: { type: "boolean" },
            command: { type: "string", minLength: 1, maxLength: 4000 },
            output: { type: "string" },
          },
          required: ["revision", "check", "passed", "command"],
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (
          input: {
            revision: string
            check: VerificationCheck
            passed: boolean
            command: string
            output?: string
          },
          toolContext: any,
        ) => {
          const sessionID = sessionIDFrom(toolContext)
          const emitRejected = (category: string) => {
            observability?.emit({
              type: "andmar.verification",
              sessionID,
              payload: {
                action: "receipt_rejected",
                category,
                check: input.check,
                claimedPassed: input.passed,
                stored: false,
              },
            })
          }

          if (input.revision.trim() === "") {
            emitRejected("invalid-revision")
            return { content: "revision must be a non-empty string" }
          }
          if (typeof input.command !== "string" || input.command.trim() === "") {
            emitRejected("invalid-command")
            return {
              content:
                "refused: command is required to resolve observed execution: run the check first through native OpenCode shell/tools, then record it with the exact same command",
            }
          }
          if (typeof sessionID !== "string" || sessionID === "") {
            return { content: "refused: cannot resolve observed execution without the current sessionID" }
          }
          const evidences = await readEvidenceList(state)
          const resolution = resolveCompatibleExecution(evidences, {
            sessionID,
            command: input.command,
            passed: input.passed,
            revision: input.revision,
          })
          if (!resolution.ok) {
            emitRejected(refusalCategory(resolution.reason))
            return { content: `refused: ${resolution.reason}` }
          }
          const resolved = resolution.execution
          if (resolved.revision === undefined) {
            await state.set(executionEvidenceKey(resolved.executionId), bindExecutionToRevision(resolved, input.revision))
          }
          const receipt: VerificationReceipt = {
            revision: input.revision,
            check: input.check,
            passed: input.passed,
            at: Date.now(),
            command: input.command,
            ...(input.output === undefined ? {} : { output: truncateOutput(input.output) }),
            sessionID,
            executionId: resolved.executionId,
          }
          const key = receiptKey(input.revision, input.check)
          await state.set(key, receipt)
          observability?.emit({
            type: "andmar.verification",
            sessionID,
            payload: {
              action: "receipt",
              check: input.check,
              passed: input.passed,
              stored: true,
            },
          })
          return { content: JSON.stringify({ stored: true, key, receipt }, null, 2) }
        },
      })

      editor.add({
        name: "verify_revision",
        description:
          "Check whether stored verification receipts satisfy the required checks for the exact current revision. A revision change invalidates earlier receipts; passed receipts without valid completed same-revision execution evidence are reported as unverified.",
        input: {
          type: "object",
          properties: {
            currentRevision: { type: "string", minLength: 1, maxLength: 200 },
            requiredChecks: { type: "array", items: { type: "string", enum: [...CHECKS] }, minItems: 1 },
          },
          required: ["currentRevision"],
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (
          input: { currentRevision: string; requiredChecks?: VerificationCheck[] },
          toolContext: any,
        ) => {
          const required = input.requiredChecks ?? DEFAULT_REQUIRED_CHECKS
          const [receipts, evidence] = await Promise.all([
            readReceipts(state, input.currentRevision),
            readEvidenceMap(state),
          ])
          const summary = summarizeVerification(input.currentRevision, receipts, required, evidence)
          observability?.emit({
            type: "andmar.verification",
            sessionID: sessionIDFrom(toolContext),
            payload: {
              action: "verify_revision",
              ok: summary.ok,
              requiredChecks: [...required],
              missingCount: summary.missing.length,
              failedCount: summary.failed.length,
              unverifiedCount: summary.unverified.length,
            },
          })
          return { content: JSON.stringify(summary, null, 2) }
        },
      })

      editor.add({
        name: "suggest_checks",
        description:
          "Suggest verification commands from deterministic project signals (lockfiles, manifests, config files). Pass a file listing obtained with native OpenCode tools; this tool reads nothing from disk and executes nothing. Confirm conventions before running.",
        input: {
          type: "object",
          properties: {
            files: { type: "array", items: { type: "string", minLength: 1 } },
            scripts: { type: "array", items: { type: "string", minLength: 1 } },
          },
          required: ["files"],
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (input: { files: string[]; scripts?: string[] }) => ({
          content: JSON.stringify(detectProjectChecks(input.files, input.scripts ?? []), null, 2),
        }),
      })
    })
    if (registration?.dispose) disposers.push(() => void registration.dispose())

    // Observe real tool executions via the official stable OpenCode V2 hook.
    // `ctx.shell` only offers `create.before` (no result), so `execute.after`
    // is the correct contract for observed outcomes. AndMar never runs
    // subprocesses itself; it only stores minimal metadata (session,
    // internal call id, tool, command + normalized form, status, timestamp
    // and an optional output digest — never full output).
    const evidenceHook = await ctx.tool.hook("execute.after", async (event: any) => {
      const evidence = buildExecutionEvidence(event, Date.now())
      if (!evidence) return
      const key = executionEvidenceKey(evidence.executionId)
      const existing = await state.get<ExecutionEvidence>(key)
      if (existing?.revision !== undefined && evidence.revision === undefined) {
        await state.set(key, { ...evidence, revision: existing.revision })
      } else if (!existing) {
        await state.set(key, evidence)
      }
    })
    if (evidenceHook?.dispose) disposers.push(() => void evidenceHook.dispose())

    return () => disposers.reverse().forEach((dispose) => dispose())
  },
}

export default verificationCapability
