import type { Capability, ChangeKind, CompletionEvidence, StateStore } from "../../core/contracts.ts"
import { evaluateCompletionV2 } from "../../core/lifecycle.ts"
import { readVerificationState } from "../../core/verification-state.ts"
import type { SemanticObservability } from "../../core/observability.ts"
import { runReview } from "../../core/review-session.ts"
import {
  MAX_REVIEW_ROUNDS,
  buildReviewPacket,
  completionSealKey,
  contractKey,
  contractStateToken,
  contractMetrics,
  createTaskContract,
  evaluateRequirementGate,
  evaluateReviewGate,
  formatContractBrief,
  isBlockingFinding,
  isTrivialTask,
  minimumReviewMode,
  recordRequirementEvidence,
  requiresIndependentReview,
  reviewAvailabilityKey,
  reviewKey,
  reviewPrefix,
  steerTaskContract,
  updateRequirementStatus,
  validateReviewResult,
  validateTaskContract,
  type EvidenceType,
  type RequirementStatus,
  type ReviewAvailabilityRecord,
  type ReviewMode,
  type ReviewRecord,
  type TaskContract,
} from "../../core/task-contract.ts"
import { routeReviewWithJev } from "./review-jev.ts"

const MAX_PACKET_FIELD_CHARS = 2000
const MAX_CHANGED_PATHS = 100
const CHECKS = ["tests", "lint", "typecheck", "build", "custom"] as const
const DEFAULT_GATE_CHECKS: readonly string[] = ["tests", "typecheck"]

function sessionIDFrom(toolContext: any): string | undefined {
  const id = toolContext?.sessionID ?? toolContext?.session?.id ?? toolContext?.metadata?.sessionID
  return typeof id === "string" && id !== "" ? id : undefined
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n…[truncated by AndMar AI]`
}

const REVIEW_SESSION_PERMISSIONS = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "read", resource: "*", effect: "allow" },
  { action: "glob", resource: "*", effect: "allow" },
  { action: "grep", resource: "*", effect: "allow" },
] as const

async function restrictReviewerSession(ctx: any, sessionID: string): Promise<boolean> {
  if (typeof ctx?.permission?.rules !== "function") return false
  try {
    await ctx.permission.rules({ sessionID, permissions: REVIEW_SESSION_PERMISSIONS })
    return true
  } catch {
    return false
  }
}

function reviewTimeoutMs(mode: ReviewMode): number {
  return mode === "audit" ? 90_000 : 180_000
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced?.[1] ?? trimmed).trim()
  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  if (start === -1 || end <= start) throw new Error("no JSON object found in reviewer output")
  return JSON.parse(candidate.slice(start, end + 1))
}

async function readContract(state: StateStore, sessionID: string): Promise<TaskContract | undefined> {
  return state.get<TaskContract>(contractKey(sessionID))
}

async function readReviews(state: StateStore, sessionID: string): Promise<ReviewRecord[]> {
  const entries = await state.scan<ReviewRecord>(reviewPrefix(sessionID))
  return entries.map((entry) => entry.value).sort((a, b) => a.round - b.round)
}

// Contract mutations are read-modify-write over the whole stored contract.
// Parallel tool calls on the same session would overwrite each other
// (last-write-wins loses evidence), so mutations of one session are
// serialized through a per-session promise chain. Read-only ops stay
// lock-free.
const writeLocks = new Map<string, Promise<unknown>>()

function withContractLock<T>(sessionID: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeLocks.get(sessionID) ?? Promise.resolve()
  const next = previous.then(operation, operation)
  writeLocks.set(
    sessionID,
    next.catch(() => undefined),
  )
  return next
}

interface MutationDeps {
  state: StateStore
  observability?: SemanticObservability | undefined
}

async function mutateTaskContract(
  sessionID: string,
  op: string,
  input: Record<string, any>,
  { state, observability }: MutationDeps,
): Promise<string> {
  if (op === "create") {
    const existing = await readContract(state, sessionID)
    if (existing && existing.status === "active") {
      return "refused: an active Task Contract already exists for this session; steer it with op=steer instead of replacing it (close it first only when the user clearly cancels or replaces the goal)"
    }
    if (!Array.isArray(input.requirements)) {
      return "refused: create requires requirements (explicit user obligations, not internal steps)"
    }
    if (typeof input.taskKind !== "string") {
      return "refused: create requires taskKind so review policy is runtime-derived, not caller-controlled"
    }
    const created = createTaskContract(sessionID, {
      taskKind: input.taskKind as ChangeKind,
      goal: input.goal,
      desiredOutcome: input.desiredOutcome,
      requirements: input.requirements,
      constraints: input.constraints,
      verificationSurface: input.verificationSurface,
    })
    if (!created.ok) return `refused: ${created.error}`
    await state.remove(completionSealKey(sessionID))
    await state.set(contractKey(sessionID), created.contract)
    observability?.emit({
      type: "andmar.contract",
      sessionID,
      payload: contractEventPayload("created", created.contract, []),
    })
    return JSON.stringify({ stored: true, contract: created.contract }, null, 2)
  }

  const contract = await readContract(state, sessionID)
  if (!contract) return `refused: no active Task Contract for this session (op=${op})`

  if (op === "update") {
    const updated = updateRequirementStatus(
      contract,
      input.requirementId,
      input.status as RequirementStatus,
      input.reason,
    )
    if (!updated.ok) return `refused: ${updated.error}`
    await state.remove(completionSealKey(sessionID))
    await state.set(contractKey(sessionID), updated.contract)
    observability?.emit({
      type: "andmar.contract",
      sessionID,
      payload: contractEventPayload("requirement_updated", updated.contract, await readReviews(state, sessionID), {
        requirementId: input.requirementId,
        toStatus: input.status,
      }),
    })
    return JSON.stringify({ stored: true, contract: updated.contract }, null, 2)
  }

  if (op === "record_evidence") {
    const recorded = recordRequirementEvidence(contract, input.requirementId, {
      type: input.type as EvidenceType,
      reference: input.reference,
      revision: input.revision,
    })
    if (!recorded.ok) return `refused: ${recorded.error}`
    await state.remove(completionSealKey(sessionID))
    await state.set(contractKey(sessionID), recorded.contract)
    observability?.emit({
      type: "andmar.contract",
      sessionID,
      payload: contractEventPayload("evidence_recorded", recorded.contract, await readReviews(state, sessionID), {
        requirementId: input.requirementId,
        evidenceType: input.type,
      }),
    })
    return JSON.stringify({ stored: true, contract: recorded.contract }, null, 2)
  }

  if (op === "steer") {
    const steered = steerTaskContract(contract, {
      addRequirements: input.addRequirements,
      addConstraints: input.addConstraints,
    })
    if (!steered.ok) return `refused: ${steered.error}`
    await state.remove(completionSealKey(sessionID))
    await state.set(contractKey(sessionID), steered.contract)
    observability?.emit({
      type: "andmar.contract",
      sessionID,
      payload: contractEventPayload("steered", steered.contract, await readReviews(state, sessionID)),
    })
    return JSON.stringify({ stored: true, contract: steered.contract }, null, 2)
  }

  if (op === "close") {
    if (input.outcome !== "completed" && input.outcome !== "blocked") {
      return 'refused: close requires outcome "completed" or "blocked"'
    }
    if (contract.status === "completed" && input.outcome === "completed") {
      return JSON.stringify({ stored: true, alreadyCompleted: true, contract }, null, 2)
    }
    if (input.outcome === "blocked" && (typeof input.reason !== "string" || input.reason.trim() === "")) {
      return "refused: closing as blocked requires a reason"
    }
    if (input.outcome === "completed") {
      if (typeof input.revision !== "string" || input.revision.trim() === "") {
        return "refused: closing as completed requires the exact revision that passed andmar_completion_gate"
      }
      const seal = await state.get<{
        revision: string
        taskKind?: ChangeKind
        contractStateToken?: string
      }>(completionSealKey(sessionID))
      if (
        !seal ||
        seal.revision !== input.revision ||
        seal.taskKind !== contract.taskKind ||
        seal.contractStateToken !== contractStateToken(contract)
      ) {
        return "refused: completion gate seal is missing or stale for the current revision and Task Contract state"
      }
    }
    const closed: TaskContract = { ...contract, status: input.outcome, updatedAt: Date.now() }
    await state.set(contractKey(sessionID), closed)
    await state.remove(completionSealKey(sessionID))
    observability?.emit({
      type: "andmar.contract",
      sessionID,
      payload: contractEventPayload("closed", closed, await readReviews(state, sessionID)),
    })
    return JSON.stringify({ stored: true, contract: closed }, null, 2)
  }

  return `refused: unknown op "${op}"`
}

function contractEventPayload(
  action: string,
  contract: TaskContract,
  reviews: ReviewRecord[],
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const metrics = contractMetrics(contract, reviews)
  return {
    action,
    status: contract.status,
    reviewRequired: contract.reviewRequired,
    requirementsTotal: metrics.requirementsTotal,
    requirementsSatisfied: metrics.requirementsSatisfied,
    requirementsPending: metrics.requirementsPending,
    requirementsBlocked: metrics.requirementsBlocked,
    ...(extra ?? {}),
  }
}

interface CompletionGateInput {
  currentRevision: string
  docsStatus?: CompletionEvidence["docsStatus"]
  versionStatus?: CompletionEvidence["versionStatus"]
  /** Compatibility only. Verification/review booleans are not authoritative. */
  evidence?: CompletionEvidence
  requiredChecks?: string[]
  taskKind: ChangeKind
}

async function evaluateAndCloseCompletion(
  sessionID: string,
  input: CompletionGateInput,
  state: StateStore,
  observability?: SemanticObservability,
): Promise<Record<string, unknown>> {
  const required = input.requiredChecks ?? [...DEFAULT_GATE_CHECKS]
  const verification =
    required.length === 0
      ? { ok: true, missing: [], failed: [], unverified: [], reasons: [] }
      : await readVerificationState(state, input.currentRevision, required)
  const docsStatus = input.docsStatus ?? input.evidence?.docsStatus
  const versionStatus = input.versionStatus ?? input.evidence?.versionStatus
  if (docsStatus === undefined || versionStatus === undefined) {
    return {
      ok: false,
      reasons: [
        "completion requires docsStatus and versionStatus (top-level preferred; legacy evidence object is still accepted)",
      ],
      contractClosed: false,
    }
  }

  // Compatibility seals from the old gate->close handshake are invalid once
  // a new completion attempt begins. New successful gates close directly.
  await state.remove(completionSealKey(sessionID))

  const derivedEvidence: CompletionEvidence = {
    revision: input.currentRevision,
    testsPassed: required.length === 0 || verification.ok,
    docsStatus,
    versionStatus,
  }
  const contract = await readContract(state, sessionID)
  const reviews = await readReviews(state, sessionID)
  const reviewAvailability = await state.get<ReviewAvailabilityRecord>(reviewAvailabilityKey(sessionID))
  const currentReviewAvailability =
    reviewAvailability !== undefined &&
    contract !== undefined &&
    reviewAvailability.revision === input.currentRevision &&
    reviewAvailability.contractStateToken === contractStateToken(contract)
      ? reviewAvailability
      : undefined

  const contractRequired = !isTrivialTask(input.taskKind)
  let contractGate: ReturnType<typeof evaluateRequirementGate> | undefined
  const contractReasons: string[] = []
  if (contract) {
    if (contract.taskKind !== input.taskKind) {
      contractReasons.push(`taskKind mismatch: contract=${contract.taskKind}, completion=${input.taskKind}`)
    }
    contractGate = evaluateRequirementGate(contract, input.currentRevision)
  } else if (contractRequired) {
    contractReasons.push(`Task Contract required for non-trivial taskKind "${input.taskKind}" but none exists for this session`)
  }

  const reviewRequired = requiresIndependentReview(contract?.taskKind ?? input.taskKind)
  const reviewGate =
    contract !== undefined || reviewRequired
      ? evaluateReviewGate(contract, reviews, input.currentRevision, reviewRequired)
      : undefined

  const combinedContractGate =
    contractGate !== undefined
      ? {
          ...contractGate,
          ok: contractGate.ok && contractReasons.length === 0,
          reasons: [...contractGate.reasons, ...contractReasons],
        }
      : contractReasons.length > 0
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
        : undefined

  let effectiveReviewGate = reviewGate
  let reviewDegraded = false
  if (reviewGate !== undefined && !reviewGate.ok && currentReviewAvailability !== undefined) {
    const currentReject =
      reviewGate.latestRevision === input.currentRevision && reviewGate.latestVerdict === "reject"
    const evidenceGateGreen = verification.ok && (combinedContractGate?.ok ?? true)
    if (currentReviewAvailability.mode === "audit" && evidenceGateGreen && !currentReject) {
      effectiveReviewGate = { ...reviewGate, ok: true, reasons: [] }
      reviewDegraded = true
    } else if (currentReviewAvailability.mode === "deep") {
      effectiveReviewGate = {
        ...reviewGate,
        reasons: [
          ...reviewGate.reasons,
          `deep review unavailable: ${currentReviewAvailability.reason} during ${currentReviewAvailability.stage}`,
        ],
      }
    }
  }

  const result = evaluateCompletionV2(
    input.currentRevision,
    derivedEvidence,
    verification,
    required,
    combinedContractGate,
    effectiveReviewGate,
  )

  let contractClosed = false
  let closedContract: TaskContract | undefined
  if (result.ok && contract !== undefined) {
    closedContract = { ...contract, status: "completed", updatedAt: Date.now() }
    await state.set(contractKey(sessionID), closedContract)
    contractClosed = true
    observability?.emit({
      type: "andmar.contract",
      sessionID,
      payload: contractEventPayload("completed_by_gate", closedContract, reviews),
    })
  }

  const metrics = contract ? contractMetrics(contract, reviews) : undefined
  const reviewRejectCount = reviews.filter((review) => review.verdict === "reject").length
  observability?.emit({
    type: "andmar.completion",
    sessionID,
    payload: {
      ok: result.ok,
      verificationDerived: true,
      testsPassed: derivedEvidence.testsPassed,
      reviewPassed: effectiveReviewGate?.ok ?? null,
      docsStatus: derivedEvidence.docsStatus,
      versionStatus: derivedEvidence.versionStatus,
      requiredChecks: [...required],
      verificationOk: verification.ok,
      missingCount: verification.missing.length,
      failedCount: verification.failed.length,
      unverifiedCount: verification.unverified.length,
      verificationPreventedCompletion: required.length > 0 && !verification.ok,
      hasContract: contract !== undefined,
      requirementsTotal: metrics?.requirementsTotal ?? 0,
      requirementsSatisfied: metrics?.requirementsSatisfied ?? 0,
      requirementsPending: metrics?.requirementsPending ?? 0,
      requirementsBlocked: metrics?.requirementsBlocked ?? 0,
      requirementGatePreventedCompletion: combinedContractGate !== undefined && !combinedContractGate.ok,
      reviewRequired,
      reviewRounds: reviews.length,
      reviewRejectCount,
      reviewApproved: reviewGate?.ok === true && reviewRequired,
      reviewDegraded,
      reviewUnavailable: currentReviewAvailability !== undefined,
      reviewUnavailableMode: currentReviewAvailability?.mode ?? null,
      contractClosed,
      finalCompletion: result.ok,
    },
  })

  return {
    ...result,
    contractClosed,
    review: {
      required: reviewRequired,
      approved: reviewGate?.ok === true && reviewRequired,
      degraded: reviewDegraded,
      unavailable:
        currentReviewAvailability === undefined
          ? null
          : {
              mode: currentReviewAvailability.mode,
              reason: currentReviewAvailability.reason,
              stage: currentReviewAvailability.stage,
              elapsedMs: currentReviewAvailability.elapsedMs,
            },
    },
  }
}

export const taskContractCapability: Capability = {
  id: "task-contract",
  version: 2,
  description: "Persist Task Contract obligations, independent review, and the evidence-derived completion boundary.",
  async setup({ ctx, config, state, observability }) {
    const registration = await ctx.tool.transform((editor: any) => {
      editor.namespace({ name: "andmar", description: "AndMar AI harness primitives" })
      editor.add({
        name: "task_contract",
        description:
          "Manage the active Task Contract for this session (op: create, status, update, record_evidence, steer, close). Create one contract per non-trivial task with the goal, explicit requirements and constraints; trivial edits skip it. A new user instruction steers the active contract instead of replacing it. Completion requires every requirement satisfied (with evidence), blocked, or explicitly skipped.",
        input: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["create", "status", "update", "record_evidence", "steer", "close"] },
            goal: { type: "string" },
            desiredOutcome: { type: "string" },
            requirements: { type: "array", items: { type: "string" } },
            constraints: { type: "array", items: { type: "string" } },
            verificationSurface: { type: "string" },
            taskKind: {
              type: "string",
              enum: ["trivial-ui", "docs-format", "known-test", "feature", "bugfix", "refactor", "debug", "architecture", "security", "migration", "review", "internal"],
            },
            requirementId: { type: "string" },
            status: { type: "string", enum: ["pending", "satisfied", "blocked", "skipped"] },
            reason: { type: "string" },
            type: { type: "string", enum: ["verification", "runtime", "diff", "review", "user-decision", "external"] },
            reference: { type: "string" },
            revision: { type: "string" },
            addRequirements: { type: "array", items: { type: "string" } },
            addConstraints: { type: "array", items: { type: "string" } },
            outcome: { type: "string", enum: ["completed", "blocked"] },
          },
          required: ["op"],
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (input: Record<string, any>, toolContext: any) => {
          const sessionID = sessionIDFrom(toolContext)
          if (!sessionID) return { content: "refused: cannot determine the current session ID" }
          const op = input.op as string

          if (op === "status") {
            const contract = await readContract(state, sessionID)
            if (!contract) return { content: JSON.stringify({ active: false }, null, 2) }
            const reviews = await readReviews(state, sessionID)
            return {
              content: JSON.stringify(
                {
                  active: true,
                  brief: formatContractBrief(contract, reviews),
                  contract,
                  metrics: contractMetrics(contract, reviews),
                  reviewRounds: reviews.length,
                  latestReview: reviews.at(-1) ?? null,
                },
                null,
                2,
              ),
            }
          }

          return {
            content: await withContractLock(sessionID, () => mutateTaskContract(sessionID, op, input, { state, observability })),
          }
        },
      })

      editor.add({
        name: "completion_gate",
        description:
          "Accept completion only when stored evidence for the exact current revision is green, Task Contract requirements are fulfilled, required independent review is satisfied, and docs/version obligations are clean. Verification/review success is derived from AndMar state instead of caller booleans. On success, the Task Contract is closed in this same operation. Legacy evidence input remains accepted for compatibility. Pass requiredChecks: [] only for tasks that genuinely require no checks.",
        input: {
          type: "object",
          properties: {
            currentRevision: { type: "string", minLength: 1 },
            docsStatus: { type: "string", enum: ["clean", "updated", "stale", "not-applicable"] },
            versionStatus: { type: "string", enum: ["clean", "updated", "required", "not-applicable"] },
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
          required: ["currentRevision", "taskKind"],
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (input: CompletionGateInput, toolContext: any) => {
          const sessionID = sessionIDFrom(toolContext)
          if (!sessionID) return { content: "refused: cannot determine the current session ID" }
          return {
            content: JSON.stringify(
              await withContractLock(sessionID, () => evaluateAndCloseCompletion(sessionID, input, state, observability)),
              null,
              2,
            ),
          }
        },
      })

      editor.add({
        name: "request_review",
        description:
          "Request one independent final review attempt in a fresh child session (frontier profile, read-only evidence auditor, compact packet from the active Task Contract). Verification must already have run for this revision. Review uses a dedicated bounded runner (audit 90s, deep 180s); timeout returns structured reviewStatus=unavailable, stores no review round, and must not trigger an automatic retry. Max two stored reject/correction rounds per task.",
        input: {
          type: "object",
          properties: {
            revision: { type: "string", minLength: 1, maxLength: 200 },
            changedPaths: { type: "array", items: { type: "string" } },
            verificationSummary: { type: "string" },
            knownLimitations: { type: "string" },
          },
          required: ["revision"],
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (
          input: { revision: string; changedPaths?: string[]; verificationSummary?: string; knownLimitations?: string },
          toolContext: any,
        ) => {
          const sessionID = sessionIDFrom(toolContext)
          if (!sessionID) return { content: "refused: cannot determine the current session ID" }
          if (input.revision.trim() === "") return { content: "refused: revision must be a non-empty string" }

          const contract = await readContract(state, sessionID)
          if (!contract) return { content: "refused: no active Task Contract for this session; create one first" }
          if (contract.status === "completed") {
            return {
              content:
                "refused: this Task Contract is already completed. Do not re-review completed work for an operational continuation; create a new active contract only if the user introduced new code/product requirements.",
            };
          }
          await state.remove(completionSealKey(sessionID))
          const contractErrors = validateTaskContract(contract)
          if (contractErrors.length > 0) {
            return { content: `refused: stored contract is invalid: ${contractErrors.join("; ")}` }
          }
          const reviews = await readReviews(state, sessionID)
          if (reviews.length >= MAX_REVIEW_ROUNDS) {
            const latest = reviews.at(-1)!
            observability?.emit({
              type: "andmar.review",
              sessionID,
              payload: { action: "denied", reason: "rounds_exhausted", rounds: reviews.length, verdict: latest.verdict },
            })
            return {
              content: `blocked: review rounds exhausted (${MAX_REVIEW_ROUNDS} rounds recorded, latest verdict=${latest.verdict}). The task is blocked; do not request another review.`,
            }
          }

          const changedPaths = (input.changedPaths ?? []).slice(0, MAX_CHANGED_PATHS)
          const minimumMode = minimumReviewMode(contract.taskKind, changedPaths.length)
          const routing = await routeReviewWithJev({
            contract,
            minimumMode,
            changedPaths,
            verificationSummary: input.verificationSummary
              ? truncate(input.verificationSummary, MAX_PACKET_FIELD_CHARS)
              : undefined,
          })
          observability?.emit({
            type: "andmar.review",
            sessionID,
            payload: {
              action: "routed",
              mode: routing.mode,
              minimumMode: routing.minimumMode,
              source: routing.source,
              jevCalled: routing.jevCalled,
              jevAvailable: routing.jevAvailable,
              reason: routing.reason ?? null,
              latencyMs: routing.latencyMs ?? null,
            },
          })
          await state.remove(reviewAvailabilityKey(sessionID))
          if (routing.mode === "none") {
            return {
              content: JSON.stringify(
                { stored: false, skipped: true, mode: "none", reason: "deterministic review bypass" },
                null,
                2,
              ),
            }
          }
          const packet = buildReviewPacket(contract, {
            revision: input.revision,
            reviewMode: routing.mode,
            changedPaths,
            verificationSummary: input.verificationSummary
              ? truncate(input.verificationSummary, MAX_PACKET_FIELD_CHARS)
              : undefined,
            knownLimitations: input.knownLimitations
              ? truncate(input.knownLimitations, MAX_PACKET_FIELD_CHARS)
              : undefined,
          })

          const round = reviews.length + 1
          const model = config.models.frontier
          const parent = await ctx.session.get({ sessionID }).catch(() => undefined)
          const selectedModel = model ?? parent?.model
          const child = await ctx.session.create({
            parentID: sessionID,
            title: `AndMar ${routing.mode} review round ${round}`,
            ...(selectedModel ? { model: selectedModel } : {}),
            metadata: { andmar: { profile: "frontier", role: "review", round } },
          })
          if (reviews.some((review) => review.reviewSessionID === child.id)) {
            return { content: "refused: review session reuse detected; retry the review request" }
          }

          const permissionsApplied = await restrictReviewerSession(ctx, child.id)
          const startedAt = Date.now()
          try {
            const run = await runReview(ctx.session, child.id, packet, reviewTimeoutMs(routing.mode))
            if (run.status === "unavailable") {
              const unavailable: ReviewAvailabilityRecord = {
                status: "unavailable",
                mode: routing.mode,
                reason: run.reason,
                stage: run.stage,
                revision: input.revision,
                reviewSessionID: child.id,
                elapsedMs: run.elapsedMs,
                contractStateToken: contractStateToken(contract),
                at: Date.now(),
              }
              await state.set(reviewAvailabilityKey(sessionID), unavailable)
              observability?.emit({
                type: "andmar.review",
                sessionID,
                payload: {
                  action: "timeout",
                  round,
                  stored: false,
                  roundConsumed: false,
                  mode: routing.mode,
                  reason: run.reason,
                  stage: run.stage,
                  durationMs: run.elapsedMs,
                },
              })
              return {
                content: JSON.stringify(
                  {
                    stored: false,
                    roundConsumed: false,
                    reviewStatus: "unavailable",
                    mode: routing.mode,
                    reason: run.reason,
                    stage: run.stage,
                    elapsedMs: run.elapsedMs,
                    completionPolicy: routing.mode === "audit" ? "evidence-gate" : "review-required",
                  },
                  null,
                  2,
                ),
              }
            }
            const text = run.text
            if (text === undefined) {
              observability?.emit({
                type: "andmar.review",
                sessionID,
                payload: { action: "invalid_output", round, stored: false, category: "no-text" },
              })
              return {
                content:
                  "invalid reviewer output: reviewer produced no final text response (only reasoning/tool calls); nothing was stored and no round was consumed. Re-request the review.",
              }
            }
            const bounded = truncate(text, 8000)
            let parsed: unknown
            try {
              parsed = extractJsonObject(bounded)
            } catch {
              observability?.emit({
                type: "andmar.review",
                sessionID,
                payload: { action: "invalid_output", round, stored: false },
              })
              return {
                content:
                  "invalid reviewer output: no parseable JSON {verdict, findings} found; nothing was stored and no round was consumed. Re-request the review.",
              }
            }
            const validated = validateReviewResult(parsed)
            if (!validated.ok) {
              observability?.emit({
                type: "andmar.review",
                sessionID,
                payload: { action: "invalid_output", round, stored: false },
              })
              return {
                content: `invalid reviewer output: ${validated.error}; nothing was stored and no round was consumed. Re-request the review.`,
              }
            }
            const blocking = validated.result.findings.filter((finding) => isBlockingFinding(contract, finding)).length
            const effectiveVerdict = blocking > 0 ? "reject" : "approve"
            const record: ReviewRecord = {
              ...validated.result,
              verdict: effectiveVerdict,
              round,
              reviewSessionID: child.id,
              revision: input.revision,
              at: Date.now(),
            }
            await state.set(reviewKey(sessionID, round), record)
            const gate = evaluateReviewGate(contract, [...reviews, record], input.revision, contract.reviewRequired)
            observability?.emit({
              type: "andmar.review",
              sessionID,
              payload: {
                action: "completed",
                round,
                mode: routing.mode,
                routingSource: routing.source,
                permissionsApplied,
                verdict: record.verdict,
                reportedVerdict: validated.result.verdict,
                findings: record.findings.length,
                blockingFindings: blocking,
                reviewRequired: contract.reviewRequired,
                gateOk: gate.ok,
                durationMs: Date.now() - startedAt,
              },
            })
            return {
              content: JSON.stringify(
                {
                  stored: true,
                  round,
                  mode: routing.mode,
                  routingSource: routing.source,
                  permissionsApplied,
                  reviewSessionID: child.id,
                  result: { ...validated.result, verdict: effectiveVerdict },
                  reportedVerdict: validated.result.verdict,
                },
                null,
                2,
              ),
            }
          } catch (error) {
            observability?.emit({
              type: "andmar.review",
              sessionID,
              payload: { action: "failed", round, stored: false, durationMs: Date.now() - startedAt },
            })
            throw error
          }
        },
      })
    })
    return registration?.dispose ? () => void registration.dispose() : undefined
  },
}

export default taskContractCapability
