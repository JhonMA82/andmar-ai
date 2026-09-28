import type { Capability, ChangeKind, CompletionEvidence, StateStore } from "../../core/contracts.ts"
import { evaluateCompletionV2 } from "../../core/lifecycle.ts"
import { readVerificationState } from "../../core/verification-state.ts"
import type { SemanticObservability } from "../../core/observability.ts"
import {
  completionSealKey,
  contractKey,
  contractStateToken,
  contractMetrics,
  createTaskContract,
  evaluateRequirementGate,
  formatContractBrief,
  isTrivialTask,
  recordRequirementEvidence,
  steerTaskContract,
  updateRequirementStatus,
  type EvidenceType,
  type RequirementStatus,
  type TaskContract,
} from "../../core/task-contract.ts"

const CHECKS = ["tests", "lint", "typecheck", "build", "custom"] as const
const DEFAULT_GATE_CHECKS: readonly string[] = ["tests", "typecheck"]

function sessionIDFrom(toolContext: any): string | undefined {
  const id = toolContext?.sessionID ?? toolContext?.session?.id ?? toolContext?.metadata?.sessionID
  return typeof id === "string" && id !== "" ? id : undefined
}

async function readContract(state: StateStore, sessionID: string): Promise<TaskContract | undefined> {
  return state.get<TaskContract>(contractKey(sessionID))
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
      return "refused: create requires taskKind so completion obligations and triviality policy are runtime-derived, not caller-controlled"
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
      payload: contractEventPayload("created", created.contract),
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
      payload: contractEventPayload("requirement_updated", updated.contract, {
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
      payload: contractEventPayload("evidence_recorded", recorded.contract, {
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
      payload: contractEventPayload("steered", steered.contract),
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
      payload: contractEventPayload("closed", closed),
    })
    return JSON.stringify({ stored: true, contract: closed }, null, 2)
  }

  return `refused: unknown op "${op}"`
}

function contractEventPayload(
  action: string,
  contract: TaskContract,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const metrics = contractMetrics(contract)
  return {
    action,
    status: contract.status,
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
  /** Compatibility only. Verification booleans are not authoritative. */
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

  const result = evaluateCompletionV2(
    input.currentRevision,
    derivedEvidence,
    verification,
    required,
    combinedContractGate,
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
      payload: contractEventPayload("completed_by_gate", closedContract),
    })
  }

  const metrics = contract ? contractMetrics(contract) : undefined
  observability?.emit({
    type: "andmar.completion",
    sessionID,
    payload: {
      ok: result.ok,
      verificationDerived: true,
      testsPassed: derivedEvidence.testsPassed,
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
      contractClosed,
      finalCompletion: result.ok,
    },
  })

  return {
    ...result,
    contractClosed,
  }
}

export const taskContractCapability: Capability = {
  id: "task-contract",
  // 3: the independent-review subsystem was removed, so the persisted
  // contract shape dropped `reviewRequired` and the `task-contract-review*`
  // key families disappeared. Old stored contracts are read as-is; the extra
  // legacy field is simply ignored, and no migration is needed.
  version: 3,
  description: "Persist Task Contract obligations and enforce the evidence-derived completion boundary.",
  async setup({ ctx, state, observability }) {
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
            type: { type: "string", enum: ["verification", "runtime", "diff", "user-decision", "external"] },
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
            return {
              content: JSON.stringify(
                {
                  active: true,
                  brief: formatContractBrief(contract),
                  contract,
                  metrics: contractMetrics(contract),
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
          "Accept completion only when stored evidence for the exact current revision is green, Task Contract requirements are fulfilled, and docs/version obligations are clean. Verification success is derived from AndMar state instead of caller booleans. On success, the Task Contract is closed in this same operation. Legacy evidence input remains accepted for compatibility. Pass requiredChecks: [] only for tasks that genuinely require no checks.",
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
    })
    return registration?.dispose ? () => void registration.dispose() : undefined
  },
}

export default taskContractCapability
