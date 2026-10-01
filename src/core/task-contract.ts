// Cross-capability read contract. Only task-contract writes these keys.
import type { ChangeKind } from "./contracts.ts"

export type RequirementStatus = "pending" | "satisfied" | "blocked" | "skipped"

export type ContractStatus = "active" | "blocked" | "completed"

export type EvidenceType = "verification" | "runtime" | "diff" | "user-decision" | "external"

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
