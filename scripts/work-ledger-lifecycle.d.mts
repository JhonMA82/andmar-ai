export interface Discovery {
  title: string
  reason: string
  risk: "low" | "medium" | "high" | "critical"
  withinGoal: boolean
  materialScope: boolean
  humanDecision: boolean
  hardToReverse: boolean
  contradictsContract: boolean
  changesObligation: boolean
  expectedFiles?: string[]
}
export interface WorkUnitProjection {
  id: string
  title: string
  state: "pending" | "active" | "done" | "blocked"
  expectedFiles: string[]
  touchedFiles: string[]
  drift: string[]
  scopeKnown: boolean
  blockedReason: string | null
}
export interface LedgerResult {
  changed: boolean
  workId: string
  title?: string
  status?: string
  active?: string | null
  units?: WorkUnitProjection[]
  checkpointRequired?: boolean
  checkpointAt?: number | null
  checkpointUser?: string | null
  blockedReason?: string | null
  [key: string]: unknown
}
export function runWorkUnitLifecycle(command: string, targetDir: string, unitArg?: string, options?: { reason?: string; expectedCheckpoint?: { user: string | null; at: number | null }; checkpointUser?: string; evidence?: string; next?: string; revision?: string; files?: string[]; discovery?: Discovery }): Promise<LedgerResult>
export function normalizeFiles(files: string[], workspace: string): string[]
export function scopeDrift(touched: string[], expected: string[]): string[]
export function classifyDiscovery(input: Discovery): { checkpointRequired: boolean; reasons: string[]; continue: boolean }
export function withLedgerLock<T>(targetDir: string, operation: () => Promise<T>): Promise<T>
