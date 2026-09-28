// Task Contract: the active obligations between the original user request
// and completion. Pure helpers only (no OpenCode imports, no capability
// imports, no storage access). The owning `task-contract` capability handles
// persistence; `lifecycle` reads contracts through these helpers to gate
// completion.
//
// A Task Contract is NOT a workflow, plan, specification engine, memory,
// TODO list or RDD/ODD artifact. It is a small, bounded record of what the
// user actually asked for: goal, explicit requirements, constraints, and
// the evidence backing each requirement.

import type { ChangeKind } from "./contracts.ts"

export type RequirementStatus = "pending" | "satisfied" | "blocked" | "skipped"

export type ContractStatus = "active" | "blocked" | "completed"

export type EvidenceType = "verification" | "runtime" | "diff" | "user-decision" | "external"

export const EVIDENCE_TYPES: readonly EvidenceType[] = [
  "verification",
  "runtime",
  "diff",
  "user-decision",
  "external",
]

export const MAX_REQUIREMENTS = 100
export const MAX_CONSTRAINTS = 20
export const MAX_TEXT_CHARS = 500
export const MAX_GOAL_CHARS = 2000
export const MAX_SURFACE_CHARS = 120

export interface EvidenceRef {
  type: EvidenceType
  reference: string
  revision?: string | undefined
  at: number
}

export interface Requirement {
  id: string
  text: string
  status: RequirementStatus
  evidence: EvidenceRef[]
  reason?: string | undefined
}

export interface Constraint {
  id: string
  text: string
}

export interface TaskContract {
  id: string
  sessionID: string
  taskKind: ChangeKind
  goal: string
  desiredOutcome?: string | undefined
  /** Closest observable surface that matters to the user (e.g. CLI, HTTP). */
  verificationSurface?: string | undefined
  requirements: Requirement[]
  constraints: Constraint[]
  status: ContractStatus
  createdAt: number
  updatedAt: number
}

// ---------------------------------------------------------------------------
// State keys (single source of truth for key shapes; capabilities must use
// these instead of hard-coding prefixes).
// ---------------------------------------------------------------------------

export function contractKey(sessionID: string): string {
  return `task-contract/${sessionID}`
}

export interface CompletionSeal {
  revision: string
  taskKind: ChangeKind
  contractStateToken?: string | undefined
  at: number
}

export function completionSealKey(sessionID: string): string {
  return `task-contract-completion/${sessionID}`
}

export function contractStateToken(contract: TaskContract): string {
  return JSON.stringify({
    id: contract.id,
    taskKind: contract.taskKind,
    status: contract.status,
    updatedAt: contract.updatedAt,
    requirements: contract.requirements.map((requirement) => ({
      id: requirement.id,
      status: requirement.status,
      evidence: requirement.evidence.map((entry) => ({
        type: entry.type,
        revision: entry.revision ?? null,
        at: entry.at,
      })),
    })),
    constraints: contract.constraints.map((constraint) => constraint.id),
  })
}

// ---------------------------------------------------------------------------
// Trivial-task policy (no mandatory contract ceremony).
// ---------------------------------------------------------------------------

const TRIVIAL_KINDS = new Set(["trivial-ui", "docs-format", "known-test", "internal"])

export function isTrivialTask(kind: string | undefined, scopeFiles?: number | undefined): boolean {
  if (kind === undefined) return false
  if (!TRIVIAL_KINDS.has(kind)) return false
  if (scopeFiles !== undefined && scopeFiles > 3) return false
  return true
}

// ---------------------------------------------------------------------------
// Creation / validation.
// ---------------------------------------------------------------------------

export interface CreateContractInput {
  taskKind: ChangeKind
  goal: string
  desiredOutcome?: string | undefined
  requirements: string[]
  constraints?: string[] | undefined
  verificationSurface?: string | undefined
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (trimmed === "" || trimmed.length > max) return undefined
  return trimmed
}

export function createTaskContract(
  sessionID: string,
  input: CreateContractInput,
  now: number = Date.now(),
): { ok: true; contract: TaskContract } | { ok: false; error: string } {
  if (typeof sessionID !== "string" || sessionID.trim() === "") {
    return { ok: false, error: "sessionID must be a non-empty string" }
  }
  const goal = cleanText(input.goal, MAX_GOAL_CHARS)
  if (!goal) return { ok: false, error: `goal must be a non-empty string up to ${MAX_GOAL_CHARS} chars` }
  if (!Array.isArray(input.requirements) || input.requirements.length === 0) {
    return { ok: false, error: "requirements must be a non-empty array of obligation texts" }
  }
  if (input.requirements.length > MAX_REQUIREMENTS) {
    return { ok: false, error: `requirements is limited to ${MAX_REQUIREMENTS} real obligations; keep internal steps out` }
  }
  const requirements: Requirement[] = []
  for (const [index, raw] of input.requirements.entries()) {
    const text = cleanText(raw, MAX_TEXT_CHARS)
    if (!text) return { ok: false, error: `requirements[${index}] must be a non-empty string up to ${MAX_TEXT_CHARS} chars` }
    requirements.push({ id: `REQ-${index + 1}`, text, status: "pending", evidence: [] })
  }
  const rawConstraints = input.constraints ?? []
  if (!Array.isArray(rawConstraints) || rawConstraints.length > MAX_CONSTRAINTS) {
    return { ok: false, error: `constraints must be an array of up to ${MAX_CONSTRAINTS} texts` }
  }
  const constraints: Constraint[] = []
  for (const [index, raw] of rawConstraints.entries()) {
    const text = cleanText(raw, MAX_TEXT_CHARS)
    if (!text) return { ok: false, error: `constraints[${index}] must be a non-empty string up to ${MAX_TEXT_CHARS} chars` }
    constraints.push({ id: `CON-${index + 1}`, text })
  }
  let desiredOutcome: string | undefined
  if (input.desiredOutcome !== undefined) {
    desiredOutcome = cleanText(input.desiredOutcome, MAX_TEXT_CHARS)
    if (!desiredOutcome) return { ok: false, error: `desiredOutcome must be a non-empty string up to ${MAX_TEXT_CHARS} chars` }
  }
  let verificationSurface: string | undefined
  if (input.verificationSurface !== undefined) {
    verificationSurface = cleanText(input.verificationSurface, MAX_SURFACE_CHARS)
    if (!verificationSurface) {
      return { ok: false, error: `verificationSurface must be a non-empty string up to ${MAX_SURFACE_CHARS} chars` }
    }
  }
  return {
    ok: true,
    contract: {
      id: `tc-${sessionID}`,
      sessionID,
      taskKind: input.taskKind,
      goal,
      ...(desiredOutcome === undefined ? {} : { desiredOutcome }),
      ...(verificationSurface === undefined ? {} : { verificationSurface }),
      requirements,
      constraints,
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  }
}

export function validateTaskContract(contract: TaskContract): string[] {
  const errors: string[] = []
  if (!contract || typeof contract !== "object") return ["contract must be an object"]
  if (typeof contract.taskKind !== "string" || contract.taskKind.trim() === "") errors.push("taskKind must be non-empty")
  if (typeof contract.goal !== "string" || contract.goal.trim() === "") errors.push("goal must be non-empty")
  if (!Array.isArray(contract.requirements) || contract.requirements.length === 0) {
    errors.push("requirements must be non-empty")
  }
  const reqIDs = new Set<string>()
  for (const req of contract.requirements ?? []) {
    if (reqIDs.has(req.id)) errors.push(`duplicate requirement id ${req.id}`)
    reqIDs.add(req.id)
    if (!["pending", "satisfied", "blocked", "skipped"].includes(req.status)) {
      errors.push(`requirement ${req.id} has invalid status ${req.status}`)
    }
    if ((req.status === "blocked" || req.status === "skipped") && !req.reason) {
      errors.push(`requirement ${req.id} is ${req.status} without a reason`)
    }
  }
  const conIDs = new Set<string>()
  for (const con of contract.constraints ?? []) {
    if (conIDs.has(con.id)) errors.push(`duplicate constraint id ${con.id}`)
    conIDs.add(con.id)
  }
  if (!["active", "blocked", "completed"].includes(contract.status)) errors.push("invalid contract status")
  return errors
}

// ---------------------------------------------------------------------------
// Steering: a new user instruction updates the active contract unless the
// user clearly cancels or replaces the original goal. Never removes.
// ---------------------------------------------------------------------------

export interface SteerInput {
  addRequirements?: string[] | undefined
  addConstraints?: string[] | undefined
}

function nextNumber(prefix: string, ids: string[]): number {
  let max = 0
  for (const id of ids) {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return max + 1
}

export function steerTaskContract(
  contract: TaskContract,
  input: SteerInput,
  now: number = Date.now(),
): { ok: true; contract: TaskContract } | { ok: false; error: string } {
  if (contract.status === "completed") {
    return { ok: false, error: "contract is completed; create a new contract for a new goal instead of steering" }
  }
  const addReq = input.addRequirements ?? []
  const addCon = input.addConstraints ?? []
  if (addReq.length === 0 && addCon.length === 0) {
    return { ok: false, error: "steer requires addRequirements and/or addConstraints" }
  }
  if (contract.requirements.length + addReq.length > MAX_REQUIREMENTS) {
    return { ok: false, error: `steering would exceed ${MAX_REQUIREMENTS} requirements` }
  }
  if (contract.constraints.length + addCon.length > MAX_CONSTRAINTS) {
    return { ok: false, error: `steering would exceed ${MAX_CONSTRAINTS} constraints` }
  }
  const requirements = [...contract.requirements]
  let reqNum = nextNumber("REQ", requirements.map((req) => req.id))
  for (const [index, raw] of addReq.entries()) {
    const text = cleanText(raw, MAX_TEXT_CHARS)
    if (!text) return { ok: false, error: `addRequirements[${index}] must be a non-empty string` }
    requirements.push({ id: `REQ-${reqNum}`, text, status: "pending", evidence: [] })
    reqNum += 1
  }
  const constraints = [...contract.constraints]
  let conNum = nextNumber("CON", constraints.map((con) => con.id))
  for (const [index, raw] of addCon.entries()) {
    const text = cleanText(raw, MAX_TEXT_CHARS)
    if (!text) return { ok: false, error: `addConstraints[${index}] must be a non-empty string` }
    constraints.push({ id: `CON-${conNum}`, text })
    conNum += 1
  }
  return {
    ok: true,
    contract: {
      ...contract,
      requirements,
      constraints,
      // New obligations reactivate a blocked contract; completed stays closed.
      status: contract.status === "blocked" ? "active" : contract.status,
      updatedAt: now,
    },
  }
}

// ---------------------------------------------------------------------------
// Requirement transitions and evidence.
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<RequirementStatus, readonly RequirementStatus[]> = {
  pending: ["satisfied", "blocked", "skipped"],
  blocked: ["pending", "satisfied", "skipped"],
  skipped: ["pending"],
  satisfied: ["pending"],
}

export function updateRequirementStatus(
  contract: TaskContract,
  requirementId: string,
  status: RequirementStatus,
  reason?: string | undefined,
  now: number = Date.now(),
): { ok: true; contract: TaskContract } | { ok: false; error: string } {
  const index = contract.requirements.findIndex((req) => req.id === requirementId)
  if (index === -1) return { ok: false, error: `unknown requirement ${requirementId}` }
  const current = contract.requirements[index]!
  if (!ALLOWED_TRANSITIONS[current.status].includes(status)) {
    return { ok: false, error: `transition ${current.status} -> ${status} is not allowed for ${requirementId}` }
  }
  if ((status === "blocked" || status === "skipped") && !cleanText(reason, MAX_TEXT_CHARS)) {
    return { ok: false, error: `${status} requires a reason for ${requirementId}` }
  }
  const requirements = contract.requirements.map((req, i) => {
    if (i !== index) return req
    const next: Requirement = {
      ...req,
      status,
      ...(status === "blocked" || status === "skipped"
        ? { reason: (reason as string).trim() }
        : { reason: undefined }),
    }
    if (next.reason === undefined) delete next.reason
    return next
  })
  return { ok: true, contract: { ...contract, requirements, updatedAt: now } }
}

const REVISION_BOUND_EVIDENCE_TYPES = new Set<EvidenceType>([
  "verification",
  "runtime",
  "diff",
])

export interface RecordEvidenceInput {
  type: EvidenceType
  reference: string
  revision?: string | undefined
}

export function recordRequirementEvidence(
  contract: TaskContract,
  requirementId: string,
  input: RecordEvidenceInput,
  now: number = Date.now(),
): { ok: true; contract: TaskContract } | { ok: false; error: string } {
  const index = contract.requirements.findIndex((req) => req.id === requirementId)
  if (index === -1) return { ok: false, error: `unknown requirement ${requirementId}` }
  if (!EVIDENCE_TYPES.includes(input.type)) {
    return { ok: false, error: `evidence type must be one of ${EVIDENCE_TYPES.join(", ")}` }
  }
  if (REVISION_BOUND_EVIDENCE_TYPES.has(input.type) && input.revision === undefined) {
    return {
      ok: false,
      error: `evidence type "${input.type}" requires the current working-state revision`,
    }
  }
  const reference = cleanText(input.reference, MAX_TEXT_CHARS)
  if (!reference) return { ok: false, error: "evidence reference must be a non-empty string (pointer, not content)" }
  let revision: string | undefined
  if (input.revision !== undefined) {
    revision = cleanText(input.revision, 200)
    if (!revision) return { ok: false, error: "evidence revision must be a non-empty string" }
  }
  const requirements = contract.requirements.map((req, i) =>
    i === index
      ? {
          ...req,
          evidence: [...req.evidence, { type: input.type, reference, ...(revision === undefined ? {} : { revision }), at: now }],
        }
      : req,
  )
  return { ok: true, contract: { ...contract, requirements, updatedAt: now } }
}

// ---------------------------------------------------------------------------
// Requirement gate: pending > 0 -> denied; blocked > 0 -> not completable;
// satisfied without evidence -> invalid; revision-bound evidence that does
// not match the current revision -> stale.
// ---------------------------------------------------------------------------

export interface RequirementGateResult {
  ok: boolean
  pending: string[]
  blocked: string[]
  missingEvidence: string[]
  stale: string[]
  reasons: string[]
  total: number
  satisfied: number
}

function requirementEvidenceCurrent(req: Requirement, currentRevision: string): "ok" | "missing" | "stale" {
  if (req.evidence.length === 0) return "missing"
  const bound = req.evidence.filter((entry) => entry.revision !== undefined)
  if (bound.length === 0) return "ok"
  return bound.some((entry) => entry.revision === currentRevision) ? "ok" : "stale"
}

export function evaluateRequirementGate(contract: TaskContract, currentRevision: string): RequirementGateResult {
  const pending: string[] = []
  const blocked: string[] = []
  const missingEvidence: string[] = []
  const stale: string[] = []
  let satisfied = 0
  for (const req of contract.requirements) {
    if (req.status === "pending") pending.push(req.id)
    else if (req.status === "blocked") blocked.push(req.id)
    else if (req.status === "satisfied") {
      satisfied += 1
      const state = requirementEvidenceCurrent(req, currentRevision)
      if (state === "missing") missingEvidence.push(req.id)
      else if (state === "stale") stale.push(req.id)
    }
  }
  const reasons: string[] = []
  if (pending.length > 0) reasons.push(`pending requirements: ${pending.join(", ")}`)
  if (blocked.length > 0) reasons.push(`blocked requirements: ${blocked.join(", ")}`)
  if (missingEvidence.length > 0) {
    reasons.push(`satisfied without evidence: ${missingEvidence.join(", ")}`)
  }
  if (stale.length > 0) {
    reasons.push(
      `stale evidence for revision "${currentRevision}": ${stale.join(", ")} (re-verify on the current working state)`,
    )
  }
  return {
    ok: reasons.length === 0,
    pending,
    blocked,
    missingEvidence,
    stale,
    reasons,
    total: contract.requirements.length,
    satisfied,
  }
}

// ---------------------------------------------------------------------------
// Metrics and compact projection (compaction continuity without transcript).
// ---------------------------------------------------------------------------

export interface ContractMetrics {
  requirementsTotal: number
  requirementsSatisfied: number
  requirementsPending: number
  requirementsBlocked: number
  requirementsSkipped: number
}

export function contractMetrics(contract: TaskContract): ContractMetrics {
  return {
    requirementsTotal: contract.requirements.length,
    requirementsSatisfied: contract.requirements.filter((req) => req.status === "satisfied").length,
    requirementsPending: contract.requirements.filter((req) => req.status === "pending").length,
    requirementsBlocked: contract.requirements.filter((req) => req.status === "blocked").length,
    requirementsSkipped: contract.requirements.filter((req) => req.status === "skipped").length,
  }
}

export interface ContractSummary {
  goal: string
  desiredOutcome?: string | undefined
  status: ContractStatus
  metrics: ContractMetrics
  pending: Array<{ id: string; text: string }>
  blocked: Array<{ id: string; text: string; reason?: string | undefined }>
  constraints: Constraint[]
}

export function summarizeContract(contract: TaskContract): ContractSummary {
  return {
    goal: contract.goal,
    ...(contract.desiredOutcome === undefined ? {} : { desiredOutcome: contract.desiredOutcome }),
    status: contract.status,
    metrics: contractMetrics(contract),
    pending: contract.requirements
      .filter((req) => req.status === "pending")
      .map((req) => ({ id: req.id, text: req.text })),
    blocked: contract.requirements
      .filter((req) => req.status === "blocked")
      .map((req) => ({ id: req.id, text: req.text, ...(req.reason === undefined ? {} : { reason: req.reason }) })),
    constraints: contract.constraints,
  }
}

/** Compact reinjection text: goal, pending, constraints, blockers. No transcript. */
export function formatContractBrief(contract: TaskContract): string {
  const summary = summarizeContract(contract)
  const lines = [
    `Goal: ${summary.goal}`,
    `Status: ${summary.status} (satisfied ${summary.metrics.requirementsSatisfied}/${summary.metrics.requirementsTotal})`,
  ]
  if (summary.desiredOutcome) lines.push(`Desired outcome: ${summary.desiredOutcome}`)
  for (const req of summary.pending) lines.push(`- ${req.id} pending: ${req.text}`)
  for (const req of summary.blocked) {
    lines.push(`- ${req.id} blocked: ${req.text}${req.reason ? ` (reason: ${req.reason})` : ""}`)
  }
  for (const con of summary.constraints) lines.push(`- ${con.id} constraint: ${con.text}`)
  return lines.join("\n")
}
