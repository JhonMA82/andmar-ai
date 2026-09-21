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
  validateReceiptEvidence,
  type ExecutionEvidence,
} from "./evidence.ts"
import { detectProjectChecks } from "./detect.ts"

const CHECKS = ["tests", "lint", "typecheck", "build", "custom"] as const

function sessionIDFrom(toolContext: any): string | undefined {
  return toolContext?.sessionID ?? toolContext?.session?.id ?? toolContext?.metadata?.sessionID
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

export const verificationCapability: Capability = {
  id: "verification",
  version: 2,
  description: "Revision-bound verification receipts backed by observed OpenCode execution evidence.",
  async setup({ ctx, state }) {
    const disposers: Array<() => void> = []

    const registration = await ctx.tool.transform((editor: any) => {
      editor.namespace({ name: "andmar", description: "AndMar AI harness primitives" })
      editor.add({
        name: "record_receipt",
        description:
          "Record the outcome of one verification check for an exact revision. Execute the command first through native OpenCode shell/tools (this tool never runs commands itself), then record the result here with the observed executionId. Passed receipts require a completed same-revision execution; failed executions can never become passed receipts.",
        input: {
          type: "object",
          properties: {
            revision: { type: "string", minLength: 1, maxLength: 200 },
            check: { type: "string", enum: [...CHECKS] },
            passed: { type: "boolean" },
            command: { type: "string" },
            output: { type: "string" },
            executionId: { type: "string", minLength: 1, maxLength: 200 },
          },
          required: ["revision", "check", "passed"],
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (
          input: {
            revision: string
            check: VerificationCheck
            passed: boolean
            command?: string
            output?: string
            executionId?: string
          },
          toolContext: any,
        ) => {
          if (input.revision.trim() === "") return { content: "revision must be a non-empty string" }
          const executionId = input.executionId?.trim() ?? ""
          const supplied = executionId !== "" ? executionId : undefined
          const stored = supplied ? await state.get<ExecutionEvidence>(executionEvidenceKey(supplied)) : undefined
          const validation = validateReceiptEvidence(
            { revision: input.revision, passed: input.passed, ...(supplied === undefined ? {} : { executionId: supplied }) },
            stored,
          )
          if (!validation.ok) {
            return {
              content: `refused: ${validation.reason}`,
            }
          }
          if (stored && stored.revision === undefined) {
            await state.set(executionEvidenceKey(stored.executionId), bindExecutionToRevision(stored, input.revision))
          }
          const sessionID = sessionIDFrom(toolContext)
          const receipt: VerificationReceipt = {
            revision: input.revision,
            check: input.check,
            passed: input.passed,
            at: Date.now(),
            ...(input.command === undefined ? {} : { command: input.command }),
            ...(input.output === undefined ? {} : { output: truncateOutput(input.output) }),
            ...(sessionID === undefined ? {} : { sessionID }),
            ...(supplied === undefined ? {} : { executionId: supplied }),
          }
          const key = receiptKey(input.revision, input.check)
          await state.set(key, receipt)
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
        execute: async (input: { currentRevision: string; requiredChecks?: VerificationCheck[] }) => {
          const required = input.requiredChecks ?? DEFAULT_REQUIRED_CHECKS
          const [receipts, evidence] = await Promise.all([
            readReceipts(state, input.currentRevision),
            readEvidenceMap(state),
          ])
          return { content: JSON.stringify(summarizeVerification(input.currentRevision, receipts, required, evidence), null, 2) }
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
    // subprocesses itself; it only stores minimal metadata (no full output).
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
