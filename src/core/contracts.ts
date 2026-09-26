export type Risk = "low" | "medium" | "high" | "critical"
export type Uncertainty = "low" | "medium" | "high"
export type ReasoningNeed = "low" | "medium" | "high"
export type ModelProfile = "fast" | "standard" | "frontier"
export type ChangeKind =
  | "trivial-ui"
  | "docs-format"
  | "known-test"
  | "feature"
  | "bugfix"
  | "refactor"
  | "debug"
  | "architecture"
  | "security"
  | "migration"
  | "review"
  | "internal"

export interface TaskSignals {
  kind: ChangeKind
  scopeFiles?: number
  risk?: Risk
  uncertainty?: Uncertainty
  reasoning?: ReasoningNeed
  publicApi?: boolean
  externalSideEffects?: boolean
  verificationFailures?: number
}

export interface ModelRef {
  providerID: string
  id: string
  variant?: string
}

export interface ModelPolicyConfig {
  fast?: ModelRef
  standard?: ModelRef
  frontier?: ModelRef
}

export interface DocumentationRule {
  id: string
  code: string[]
  docs: string[]
}

export interface HarnessConfig {
  models: ModelPolicyConfig
  delegation: {
    maxDepth: number
    maxResultChars: number
  }
  shell: {
    maxTimeoutMs: number
  }
  documentation: {
    rules: DocumentationRule[]
  }
  versioning: {
    enabled: boolean
    publicPaths: string[]
  }
  delivery: {
    workUnitCommits: "manual" | "auto"
  }
}

import type { SemanticObservability } from "./observability.ts"

export interface CapabilityRuntime {
  ctx: any
  config: HarnessConfig
  state: StateStore
  observability?: SemanticObservability
}

export interface Capability {
  id: string
  version: number
  description: string
  setup(runtime: CapabilityRuntime): Promise<void | (() => void)>
}

export interface StateStore {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
  scan<T>(prefix: string): Promise<Array<{ key: string; value: T }>>
}

export interface WorkerRecord {
  sessionID: string
  parentSessionID: string
  profile: ModelProfile
  depth: number
  status: "running" | "idle" | "failed" | "cancelled"
  createdAt: number
  updatedAt: number
}

export interface CompletionEvidence {
  revision: string
  testsPassed: boolean
  reviewPassed?: boolean
  docsStatus: "clean" | "updated" | "stale" | "not-applicable"
  versionStatus: "clean" | "updated" | "required" | "not-applicable"
}
