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
import { detectProjectChecks } from "./detect.ts"

const CHECKS = ["tests", "lint", "typecheck", "build", "custom"] as const

function sessionIDFrom(toolContext: any): string | undefined {
  return toolContext?.sessionID ?? toolContext?.session?.id ?? toolContext?.metadata?.sessionID
}

async function readReceipts(state: StateStore, revision: string): Promise<VerificationReceipt[]> {
  const entries = await state.scan<VerificationReceipt>(receiptPrefix(revision))
  return entries.map((entry) => entry.value)
}

export const verificationCapability: Capability = {
  id: "verification",
  version: 1,
  description: "Revision-bound verification receipts recorded from native OpenCode execution.",
  async setup({ ctx, state }) {
    const registration = await ctx.tool.transform((editor: any) => {
      editor.namespace({ name: "andmar", description: "AndMar AI harness primitives" })
      editor.add({
        name: "record_receipt",
        description:
          "Record the outcome of one verification check for an exact revision. Execute the command first through native OpenCode shell/tools (this tool never runs commands itself), then record the result here.",
        input: {
          type: "object",
          properties: {
            revision: { type: "string", minLength: 1, maxLength: 200 },
            check: { type: "string", enum: [...CHECKS] },
            passed: { type: "boolean" },
            command: { type: "string" },
            output: { type: "string" },
          },
          required: ["revision", "check", "passed"],
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (
          input: { revision: string; check: VerificationCheck; passed: boolean; command?: string; output?: string },
          toolContext: any,
        ) => {
          if (input.revision.trim() === "") return { content: "revision must be a non-empty string" }
          const sessionID = sessionIDFrom(toolContext)
          const receipt: VerificationReceipt = {
            revision: input.revision,
            check: input.check,
            passed: input.passed,
            at: Date.now(),
            ...(input.command === undefined ? {} : { command: input.command }),
            ...(input.output === undefined ? {} : { output: truncateOutput(input.output) }),
            ...(sessionID === undefined ? {} : { sessionID }),
          }
          const key = receiptKey(input.revision, input.check)
          await state.set(key, receipt)
          return { content: JSON.stringify({ stored: true, key, receipt }, null, 2) }
        },
      })

      editor.add({
        name: "verify_revision",
        description:
          "Check whether stored verification receipts satisfy the required checks for the exact current revision. A revision change invalidates earlier receipts.",
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
          const receipts = await readReceipts(state, input.currentRevision)
          return { content: JSON.stringify(summarizeVerification(input.currentRevision, receipts, required), null, 2) }
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
    return registration?.dispose ? () => void registration.dispose() : undefined
  },
}

export default verificationCapability
