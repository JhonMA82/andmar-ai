import type { Capability, ChangeKind, CompletionEvidence } from "../../core/contracts.ts"
import {
  analyzeDocumentationImpact,
  evaluateCompletionWithVerification,
  inferVersionImpact,
  type VerificationGateStatus,
} from "../../core/lifecycle.ts"
import { matchesAny } from "../../core/glob.ts"

const CHECKS = ["tests", "lint", "typecheck", "build", "custom"] as const
const DEFAULT_GATE_CHECKS: readonly string[] = ["tests", "typecheck"]
const RECEIPT_COLLECTION_PREFIX = "verification/"
const OBSERVED_EVIDENCE_PREFIX = "verification-evidence/"

interface StoredReceiptLike {
  revision: string
  check: string
  passed: boolean
  at: number
  executionId?: string
}

interface StoredEvidenceLike {
  executionId: string
  status: string
  revision?: string
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value)
}

async function readVerificationStatus(
  state: { scan<T>(prefix: string): Promise<Array<{ key: string; value: T }>> },
  currentRevision: string,
  requiredChecks: readonly string[],
): Promise<VerificationGateStatus> {
  const receiptEntries = await state.scan<StoredReceiptLike>(`${RECEIPT_COLLECTION_PREFIX}${encodeSegment(currentRevision)}/`)
  const evidenceEntries = await state.scan<StoredEvidenceLike>(OBSERVED_EVIDENCE_PREFIX)
  const byId = new Map<string, StoredEvidenceLike>()
  for (const entry of evidenceEntries) {
    if (entry.value && typeof entry.value.executionId === "string") byId.set(entry.value.executionId, entry.value)
  }
  const latest = new Map<string, StoredReceiptLike>()
  for (const entry of receiptEntries) {
    const receipt = entry.value
    if (!receipt || receipt.revision !== currentRevision || typeof receipt.check !== "string") continue
    const existing = latest.get(receipt.check)
    if (!existing || receipt.at >= existing.at) latest.set(receipt.check, receipt)
  }
  const missing: string[] = []
  const failed: string[] = []
  const unverified: string[] = []
  for (const check of requiredChecks) {
    const receipt = latest.get(check)
    if (!receipt) {
      missing.push(check)
      continue
    }
    if (receipt.passed) {
      const execution = receipt.executionId ? byId.get(receipt.executionId) : undefined
      const bound = execution !== undefined && (execution.revision === undefined || execution.revision === currentRevision)
      if (!receipt.executionId || !execution || execution.status !== "completed" || !bound) {
        unverified.push(check)
        continue
      }
    } else {
      failed.push(check)
    }
  }
  const reasons: string[] = []
  if (missing.length > 0) reasons.push(`missing receipts for: ${missing.join(", ")}`)
  if (failed.length > 0) reasons.push(`failed checks: ${failed.join(", ")}`)
  if (unverified.length > 0) {
    reasons.push(`unverified receipts (no valid completed same-revision execution): ${unverified.join(", ")}`)
  }
  return { ok: reasons.length === 0, missing, failed, unverified, reasons }
}

export const lifecycleCapability: Capability = {
  id: "lifecycle",
  version: 2,
  description: "Deterministic documentation, versioning and completion gates.",
  async setup({ ctx, config, state }) {
    const registration = await ctx.tool.transform((editor: any) => {
      editor.namespace({ name: "andmar", description: "AndMar AI harness primitives" })
      editor.add({
        name: "change_impact",
        description: "Evaluate documentation and version impact from changed paths and an explicit change kind.",
        input: {
          type: "object",
          properties: {
            changedPaths: { type: "array", items: { type: "string" }, minItems: 1 },
            kind: {
              type: "string",
              enum: ["trivial-ui", "docs-format", "known-test", "feature", "bugfix", "refactor", "debug", "architecture", "security", "migration", "review", "internal"],
            },
            breaking: { type: "boolean" },
          },
          required: ["changedPaths", "kind"],
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (input: { changedPaths: string[]; kind: ChangeKind; breaking?: boolean }) => {
          const docs = analyzeDocumentationImpact(input.changedPaths, config.documentation.rules)
          const touchesPublicSurface = input.changedPaths.some((path) => matchesAny(config.versioning.publicPaths, path))
          const version = config.versioning.enabled
            ? inferVersionImpact({ kind: input.kind, touchesPublicSurface, ...(input.breaking === undefined ? {} : { breaking: input.breaking }) })
            : "none"
          return { content: JSON.stringify({ docs, version, touchesPublicSurface }, null, 2) }
        },
      })

      editor.add({
        name: "completion_gate",
        description:
          "Accept completion only when evidence belongs to the exact current revision, lifecycle gates are clean, and required verification receipts are satisfied. A manual testsPassed flag alone can never formally verify a revision with missing verification; pass requiredChecks: [] only for tasks that genuinely require no checks.",
        input: {
          type: "object",
          properties: {
            currentRevision: { type: "string", minLength: 1 },
            evidence: {
              type: "object",
              properties: {
                revision: { type: "string", minLength: 1 },
                testsPassed: { type: "boolean" },
                reviewPassed: { type: "boolean" },
                docsStatus: { type: "string", enum: ["clean", "updated", "stale", "not-applicable"] },
                versionStatus: { type: "string", enum: ["clean", "updated", "required", "not-applicable"] },
              },
              required: ["revision", "testsPassed", "docsStatus", "versionStatus"],
              additionalProperties: false,
            },
            requiredChecks: { type: "array", items: { type: "string", enum: [...CHECKS] } },
          },
          required: ["currentRevision", "evidence"],
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (input: {
          currentRevision: string
          evidence: CompletionEvidence
          requiredChecks?: string[]
        }) => {
          const required = input.requiredChecks ?? [...DEFAULT_GATE_CHECKS]
          const verification =
            required.length === 0
              ? { ok: true, missing: [], failed: [], unverified: [], reasons: [] }
              : await readVerificationStatus(state, input.currentRevision, required)
          return {
            content: JSON.stringify(
              evaluateCompletionWithVerification(input.currentRevision, input.evidence, verification, required),
              null,
              2,
            ),
          }
        },
      })
    })
    return registration?.dispose ? () => void registration.dispose() : undefined
  },
}

export default lifecycleCapability
