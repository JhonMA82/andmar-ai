import type { Capability, ChangeKind, CompletionEvidence } from "../../core/contracts.ts"
import {
  analyzeDocumentationImpact,
  evaluateCompletionV2,
  inferVersionImpact,
  type VerificationGateStatus,
} from "../../core/lifecycle.ts"
import {
  completionSealKey,
  contractKey,
  contractMetrics,
  evaluateRequirementGate,
  evaluateReviewGate,
  isTrivialTask,
  requiresIndependentReview,
  reviewPrefix,
  type ReviewRecord,
  type TaskContract,
} from "../../core/task-contract.ts"
import { matchesAny } from "../../core/glob.ts"

const CHECKS = ["tests", "lint", "typecheck", "build", "custom"] as const
const DEFAULT_GATE_CHECKS: readonly string[] = ["tests", "typecheck"]
const RECEIPT_COLLECTION_PREFIX = "verification/"
const OBSERVED_EVIDENCE_PREFIX = "verification-evidence/"

function sessionIDFrom(toolContext: any): string | undefined {
  return toolContext?.sessionID ?? toolContext?.session?.id ?? toolContext?.metadata?.sessionID
}

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
  async setup({ ctx, config, state, observability }) {
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
          "Accept completion only when evidence belongs to the exact current revision, the Task Contract requirement gate passes, required independent review is recorded, lifecycle gates are clean, and required verification receipts are satisfied. A manual testsPassed flag alone can never formally verify a revision with missing verification; pass requiredChecks: [] only for tasks that genuinely require no checks. Trivial tasks without a contract keep the legacy behavior.",
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
            taskKind: {
              type: "string",
              enum: ["trivial-ui", "docs-format", "known-test", "feature", "bugfix", "refactor", "debug", "architecture", "security", "migration", "review", "internal"],
            },
          },
          required: ["currentRevision", "evidence", "taskKind"],
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (
          input: {
            currentRevision: string
            evidence: CompletionEvidence
            requiredChecks?: string[]
            taskKind: ChangeKind
          },
          toolContext: any,
        ) => {
          const required = input.requiredChecks ?? [...DEFAULT_GATE_CHECKS]
          const verification =
            required.length === 0
              ? { ok: true, missing: [], failed: [], unverified: [], reasons: [] }
              : await readVerificationStatus(state, input.currentRevision, required)
          const sessionID = sessionIDFrom(toolContext)
          if (sessionID !== undefined) {
            // Every gate attempt invalidates any older success seal; only this
            // exact evaluation may write a new one.
            await state.remove(completionSealKey(sessionID))
          }
          const contract =
            sessionID !== undefined ? await state.get<TaskContract>(contractKey(sessionID)) : undefined
          const reviews =
            sessionID !== undefined
              ? (await state.scan<ReviewRecord>(reviewPrefix(sessionID))).map((entry) => entry.value)
              : []

          // Task Contract policy is derived from taskKind, never from optional
          // caller bypass flags. Non-trivial tasks must have a contract.
          const contractRequired = !isTrivialTask(input.taskKind)
          let contractGate: ReturnType<typeof evaluateRequirementGate> | undefined
          const contractReasons: string[] = []
          if (contract) {
            if (contract.taskKind !== input.taskKind) {
              contractReasons.push(
                `taskKind mismatch: contract=${contract.taskKind}, completion=${input.taskKind}`,
              )
            }
            contractGate = evaluateRequirementGate(contract, input.currentRevision)
          } else if (contractRequired) {
            contractReasons.push(
              `Task Contract required for non-trivial taskKind "${input.taskKind}" but none exists for this session`,
            )
          }

          // Review policy is also derived. A caller cannot disable review for
          // a code-changing task by omitting/setting a flag.
          const reviewRequired = requiresIndependentReview(contract?.taskKind ?? input.taskKind)
          const reviewGate =
            contract !== undefined || reviewRequired
              ? evaluateReviewGate(contract, reviews, input.currentRevision, reviewRequired)
              : undefined

          const combinedContractGate =
            contractGate ??
            (contractReasons.length > 0
              ? {
                  ok: false,
                  pending: [],
                  blocked: [],
                  missingEvidence: [],
                  stale: [],
                  reasons: contractReasons,
                  total: 0,
                  satisfied: 0,
                }
              : undefined)
          const result = evaluateCompletionV2(
            input.currentRevision,
            input.evidence,
            verification,
            required,
            combinedContractGate,
            reviewGate,
          )
          if (result.ok && sessionID !== undefined) {
            await state.set(completionSealKey(sessionID), {
              revision: input.currentRevision,
              taskKind: input.taskKind,
              at: Date.now(),
            })
          }

          const metrics = contract ? contractMetrics(contract, reviews) : undefined
          const reviewRejectCount = reviews.filter((review) => review.verdict === "reject").length
          observability?.emit({
            type: "andmar.completion",
            sessionID: sessionIDFrom(toolContext),
            payload: {
              ok: result.ok,
              testsPassed: input.evidence.testsPassed,
              reviewPassed: input.evidence.reviewPassed ?? null,
              docsStatus: input.evidence.docsStatus,
              versionStatus: input.evidence.versionStatus,
              requiredChecks: [...required],
              verificationOk: verification.ok,
              missingCount: verification.missing.length,
              failedCount: verification.failed.length,
              unverifiedCount: verification.unverified.length,
              verificationPreventedCompletion:
                required.length > 0 && input.evidence.testsPassed && !verification.ok,
              hasContract: contract !== undefined,
              requirementsTotal: metrics?.requirementsTotal ?? 0,
              requirementsSatisfied: metrics?.requirementsSatisfied ?? 0,
              requirementsPending: metrics?.requirementsPending ?? 0,
              requirementsBlocked: metrics?.requirementsBlocked ?? 0,
              requirementGatePreventedCompletion: combinedContractGate !== undefined && !combinedContractGate.ok,
              reviewRequired,
              reviewRounds: reviews.length,
              reviewRejectCount,
              reviewApproved: reviewGate !== undefined && reviewGate.ok && reviewRequired,
              finalCompletion: result.ok,
            },
          })
          return {
            content: JSON.stringify(result, null, 2),
          }
        },
      })
    })
    return registration?.dispose ? () => void registration.dispose() : undefined
  },
}

export default lifecycleCapability
