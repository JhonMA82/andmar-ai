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

export type RequirementStatus = "pending" | "satisfied" | "blocked" | "skipped"

export type ContractStatus = "active" | "blocked" | "completed"

export type EvidenceType = "verification" | "runtime" | "diff" | "review" | "user-decision" | "external"

export type ReviewVerdict = "approve" | "reject"

export const EVIDENCE_TYPES: readonly EvidenceType[] = [
  "verification",
  "runtime",
  "diff",
  "review",
  "user-decision",
  "external",
]

/** Hard cap on independent review rounds per task (spec: normal 1, max 2). */
export const MAX_REVIEW_ROUNDS = 2

export const MAX_REQUIREMENTS = 20
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
  goal: string
  desiredOutcome?: string | undefined
  /** Closest observable surface that matters to the user (e.g. CLI, HTTP). */
  verificationSurface?: string | undefined
  requirements: Requirement[]
  constraints: Constraint[]
  /** False only for trivial tasks that skip review ceremony. */
  reviewRequired: boolean
  status: ContractStatus
  createdAt: number
  updatedAt: number
}

export interface ReviewFinding {
  requirementId?: string | undefined
  constraintId?: string | undefined
  observation: string
  evidencePointer: string
}

export interface ReviewResult {
  verdict: ReviewVerdict
  findings: ReviewFinding[]
  notes?: string[] | undefined
}

export interface ReviewRecord extends ReviewResult {
  round: number
  reviewSessionID: string
  revision: string
  at: number
}

// ---------------------------------------------------------------------------
// State keys (single source of truth for key shapes; capabilities must use
// these instead of hard-coding prefixes).
// ---------------------------------------------------------------------------

export function contractKey(sessionID: string): string {
  return `task-contract/${sessionID}`
}

export function reviewKey(sessionID: string, round: number): string {
  return `task-contract-review/${sessionID}/${round}`
}

export function reviewPrefix(sessionID: string): string {
  return `task-contract-review/${sessionID}/`
}

// ---------------------------------------------------------------------------
// Trivial-task policy (no mandatory contract/reviewer ceremony).
// ---------------------------------------------------------------------------

const TRIVIAL_KINDS = new Set(["trivial-ui", "docs-format", "known-test", "internal"])

export function isTrivialTask(kind: string | undefined, scopeFiles?: number | undefined): boolean {
  if (kind === undefined) return false
  if (!TRIVIAL_KINDS.has(kind)) return false
  if (scopeFiles !== undefined && scopeFiles > 3) return false
  return true
}

const CODE_CHANGING_KINDS = new Set([
  "feature",
  "bugfix",
  "refactor",
  "debug",
  "architecture",
  "security",
  "migration",
])

/** Non-trivial code-changing work requires an independent final review. */
export function requiresIndependentReview(kind: string | undefined): boolean {
  if (kind === undefined) return true
  return CODE_CHANGING_KINDS.has(kind)
}

// ---------------------------------------------------------------------------
// Creation / validation.
// ---------------------------------------------------------------------------

export interface CreateContractInput {
  goal: string
  desiredOutcome?: string | undefined
  requirements: string[]
  constraints?: string[] | undefined
  verificationSurface?: string | undefined
  reviewRequired?: boolean | undefined
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
      goal,
      ...(desiredOutcome === undefined ? {} : { desiredOutcome }),
      ...(verificationSurface === undefined ? {} : { verificationSurface }),
      requirements,
      constraints,
      reviewRequired: input.reviewRequired ?? true,
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  }
}

export function validateTaskContract(contract: TaskContract): string[] {
  const errors: string[] = []
  if (!contract || typeof contract !== "object") return ["contract must be an object"]
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
// Review validation and gate.
// ---------------------------------------------------------------------------

/**
 * Normalize a reviewer verdict tolerantly: models commonly emit
 * "APPROVE", "Approved.", "rejected", etc. The stored verdict is always
 * the canonical lowercase enum; anything else is invalid.
 */
export function normalizeVerdict(value: unknown): ReviewVerdict | undefined {
  if (typeof value !== "string") return undefined
  const v = value.trim().toLowerCase().replace(/\.$/, "")
  if (v === "approve" || v === "approved" || v === "approval") return "approve"
  if (v === "reject" || v === "rejected" || v === "rejection") return "reject"
  return undefined
}

export function validateReviewResult(input: unknown): { ok: true; result: ReviewResult } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "review result must be a JSON object" }
  }
  const record = input as Record<string, unknown>
  const verdict = normalizeVerdict(record.verdict)
  if (!verdict) {
    return { ok: false, error: 'review verdict must be "approve" or "reject"' }
  }
  if (!Array.isArray(record.findings)) return { ok: false, error: "review findings must be an array" }
  const findings: ReviewFinding[] = []
  for (const [index, raw] of record.findings.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `findings[${index}] must be an object` }
    }
    const finding = raw as Record<string, unknown>
    if (typeof finding.observation !== "string" || finding.observation.trim() === "") {
      return { ok: false, error: `findings[${index}].observation must be a non-empty string` }
    }
    if (typeof finding.evidencePointer !== "string" || finding.evidencePointer.trim() === "") {
      return { ok: false, error: `findings[${index}].evidencePointer must be a non-empty string` }
    }
    findings.push({
      ...(typeof finding.requirementId === "string" && finding.requirementId !== "" ? { requirementId: finding.requirementId } : {}),
      ...(typeof finding.constraintId === "string" && finding.constraintId !== "" ? { constraintId: finding.constraintId } : {}),
      observation: finding.observation.trim(),
      evidencePointer: finding.evidencePointer.trim(),
    })
  }
  let notes: string[] | undefined
  if (record.notes !== undefined) {
    if (!Array.isArray(record.notes) || record.notes.some((note) => typeof note !== "string")) {
      return { ok: false, error: "review notes must be an array of strings" }
    }
    notes = (record.notes as string[]).map((note) => note.trim()).filter((note) => note !== "")
  }
  return {
    ok: true,
    result: { verdict, findings, ...(notes === undefined ? {} : { notes }) },
  }
}

/**
 * A finding only blocks when it is linked to a real requirement,
 * constraint, or a missing-evidence pointer. Taste and scope expansion
 * never block (reviewer discipline; reported here for transparency).
 */
export function isBlockingFinding(contract: TaskContract, finding: ReviewFinding): boolean {
  if (finding.requirementId !== undefined) {
    if (contract.requirements.some((req) => req.id === finding.requirementId)) return true
  }
  if (finding.constraintId !== undefined) {
    if (contract.constraints.some((con) => con.id === finding.constraintId)) return true
  }
  return false
}

export interface ReviewGateResult {
  ok: boolean
  required: boolean
  rounds: number
  latestVerdict?: ReviewVerdict | undefined
  latestRevision?: string | undefined
  rejectCount: number
  blockingFindings: number
  exhausted: boolean
  reasons: string[]
}

export function evaluateReviewGate(
  contract: TaskContract | undefined,
  reviews: readonly ReviewRecord[],
  currentRevision: string,
  required: boolean,
): ReviewGateResult {
  const sorted = [...reviews].sort((a, b) => a.round - b.round)
  const latest = sorted.at(-1)
  const rejectCount = sorted.filter((review) => review.verdict === "reject").length
  const exhausted = sorted.length >= MAX_REVIEW_ROUNDS && latest?.verdict === "reject"
  if (!required) {
    return {
      ok: true,
      required: false,
      rounds: sorted.length,
      ...(latest === undefined ? {} : { latestVerdict: latest.verdict, latestRevision: latest.revision }),
      rejectCount,
      blockingFindings: 0,
      exhausted: false,
      reasons: [],
    }
  }
  const reasons: string[] = []
  if (latest === undefined) reasons.push("independent review required but no review recorded")
  else {
    if (latest.revision !== currentRevision) {
      reasons.push(
        `latest review (round ${latest.round}) targets revision "${latest.revision}", not the current revision "${currentRevision}"`,
      )
    }
    if (latest.verdict === "reject") reasons.push(`latest review (round ${latest.round}) rejected completion`)
    if (exhausted) reasons.push(`review rounds exhausted (${MAX_REVIEW_ROUNDS} rejects): task is blocked`)
  }
  let blockingFindings = 0
  if (contract && latest) {
    blockingFindings = latest.findings.filter((finding) => isBlockingFinding(contract, finding)).length
  }
  return {
    ok: reasons.length === 0,
    required: true,
    rounds: sorted.length,
    ...(latest === undefined ? {} : { latestVerdict: latest.verdict, latestRevision: latest.revision }),
    rejectCount,
    blockingFindings,
    exhausted,
    reasons,
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
  reviewRounds: number
  reviewRejectCount: number
}

export function contractMetrics(contract: TaskContract, reviews: readonly ReviewRecord[] = []): ContractMetrics {
  return {
    requirementsTotal: contract.requirements.length,
    requirementsSatisfied: contract.requirements.filter((req) => req.status === "satisfied").length,
    requirementsPending: contract.requirements.filter((req) => req.status === "pending").length,
    requirementsBlocked: contract.requirements.filter((req) => req.status === "blocked").length,
    requirementsSkipped: contract.requirements.filter((req) => req.status === "skipped").length,
    reviewRounds: reviews.length,
    reviewRejectCount: reviews.filter((review) => review.verdict === "reject").length,
  }
}

export interface ContractSummary {
  goal: string
  desiredOutcome?: string | undefined
  status: ContractStatus
  reviewRequired: boolean
  metrics: ContractMetrics
  pending: Array<{ id: string; text: string }>
  blocked: Array<{ id: string; text: string; reason?: string | undefined }>
  constraints: Constraint[]
}

export function summarizeContract(contract: TaskContract, reviews: readonly ReviewRecord[] = []): ContractSummary {
  return {
    goal: contract.goal,
    ...(contract.desiredOutcome === undefined ? {} : { desiredOutcome: contract.desiredOutcome }),
    status: contract.status,
    reviewRequired: contract.reviewRequired,
    metrics: contractMetrics(contract, reviews),
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
export function formatContractBrief(contract: TaskContract, reviews: readonly ReviewRecord[] = []): string {
  const summary = summarizeContract(contract, reviews)
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
  if (reviews.length > 0) {
    const latest = [...reviews].sort((a, b) => a.round - b.round).at(-1)!
    lines.push(`Review: round ${latest.round}/${MAX_REVIEW_ROUNDS} verdict=${latest.verdict} revision=${latest.revision}`)
  }
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Review packet: compact context for a fresh reviewer session. No transcript,
// no internal reasoning, no full logs, no repository dump.
// ---------------------------------------------------------------------------

export interface ReviewPacketInput {
  revision: string
  changedPaths?: string[] | undefined
  verificationSummary?: string | undefined
  knownLimitations?: string | undefined
}

export function buildReviewPacket(contract: TaskContract, input: ReviewPacketInput): string {
  const lines = [
    "You are an independent final reviewer. You are read-only: inspect, search and run read-only checks, but do not edit files, apply fixes, or record anything. Judge only the work described below.",
    "",
    "Assume completion claims are unverified until evidence shows otherwise.",
    "Compare: (1) original goal against final behavior; (2) requirements against implementation; (3) constraints against the diff; (4) claims against verification evidence; (5) external contracts against implementation; (6) tests against what they actually prove.",
    "Look specifically for: explicit requirements missed; constraints violated; unsupported completion claims; stale or deprecated upstream API use; mock-only verification represented as runtime proof; missing observable-surface verification; scope drift; incomplete error or failure behavior when explicitly required.",
    "Do not invent new requirements. Do not reject for architecture taste. Do not expand scope. A finding blocks only when it is linked to a requirementId or constraintId below, to the desired outcome, or to missing required evidence.",
    "",
    `Original goal: ${contract.goal}`,
  ]
  if (contract.desiredOutcome) lines.push(`Desired outcome: ${contract.desiredOutcome}`)
  if (contract.verificationSurface) {
    lines.push(`Verification surface: verify at ${contract.verificationSurface}, the closest observable surface that matters to the user.`)
  }
  lines.push("", "Requirements:")
  for (const req of contract.requirements) {
    const evidence =
      req.evidence.length === 0 ? "no evidence" : req.evidence.map((entry) => `${entry.type}:${entry.reference}`).join(", ")
    lines.push(`- ${req.id} [${req.status}] ${req.text} (evidence: ${evidence})${req.reason ? ` reason: ${req.reason}` : ""}`)
  }
  lines.push("Constraints:")
  if (contract.constraints.length === 0) lines.push("- none")
  for (const con of contract.constraints) lines.push(`- ${con.id}: ${con.text}`)
  lines.push(`Revision under review: ${input.revision}`)
  if (input.changedPaths && input.changedPaths.length > 0) {
    lines.push(`Changed paths: ${input.changedPaths.join(", ")}`)
  }
  if (input.verificationSummary) lines.push(`Verification summary: ${input.verificationSummary}`)
  if (input.knownLimitations) lines.push(`Known limitations: ${input.knownLimitations}`)
  lines.push(
    "",
    "Respond with ONLY one JSON object, no prose before or after, exactly this shape:",
    '{"verdict": "approve" | "reject", "findings": [{"requirementId"?: "REQ-n", "constraintId"?: "CON-n", "observation": "...", "evidencePointer": "..."}], "notes"?: ["..."]}',
    'The verdict value must be exactly the lowercase string "approve" or "reject".',
  )
  return lines.join("\n")
}
