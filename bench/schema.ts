import { createHash } from "node:crypto"

export type Measured = number | null
export type Mode = "build" | "andmar"
export interface Check { id: string; argv: string[]; timeoutMs: number }
export interface Task {
  schemaVersion: 1
  id: string
  category: "trivial" | "bugfix" | "feature" | "refactor" | "integration"
  repository: string
  baseRevision: string
  initialFiles?: Record<string, string>
  prompt: string
  setup: Check[]
  timeoutMs: number
  allowedFiles: string[]
  forbiddenFiles: string[]
  verification: { commands: Check[]; expectedFiles: string[] }
  requirements: { id: string; checks: string[] }[]
  successCriterion: "all-checks-and-scope"
}
export interface Usage {
  tokens: { input: Measured; output: Measured; reasoning: Measured; cacheRead: Measured; cacheWrite: Measured; total: Measured }
  cost: { reported: Measured; estimated: Measured }
  steps: Measured
  tools: { calls: Measured; succeeded: Measured; failed: Measured; unfinished: Measured; durationP50: Measured }
  sessions: Measured
  subagents: Measured
  retries: Measured
  modelErrors: Measured
}
export interface Result extends Usage {
  schemaVersion: 1
  runId: string
  pairId: string
  repetition: number
  taskId: string
  mode: Mode
  harness: { version: string; revision: string; sourceHash: string } | null
  startedAt: string
  finishedAt: string
  durationMs: number
  agentDurationMs: number
  verificationDurationMs: number
  model: string
  variant: string | null
  provider: string
  conditions: Record<string, string>
  comparable: boolean
  comparabilityIssues: string[]
  measurement: { source: string; warnings: string[]; auxiliaryUsage: "unmeasured"; pricing: unknown }
  exitStatus: number | null
  timedOut: boolean
  error: string | null
  verification: { passed: boolean; failedChecks: string[]; checks: { id: string; passed: boolean; exitStatus: number | null; timedOut: boolean }[] }
  changedFiles: string[]
  unexpectedFiles: string[]
  operationalFiles: string[]
  requirements: { total: number; satisfied: number; missed: number }
  userCorrections: Measured
  reworkCount: Measured
  quality: { taskSuccess: boolean; firstPassSuccess: boolean | null; falseCompletion: boolean | null; completionClaim: boolean | null; userInterventions: Measured }
  contextPressure: { source: "native-input-usage" | "unmeasured"; peakPromptTokens: Measured; contextWindow: Measured; occupancyPct: Measured; breakdown: "unmeasured" }
  work: { policyToolCalls: Measured; product: "unmeasured"; policy: "unmeasured"; verification: "unmeasured"; delegated: "unmeasured" }
  developmentMetrics: unknown
  ledgerMetrics: unknown
}

export function record(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
export function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message) }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 }
export function numberOrNull(value: unknown): Measured {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}
function metric(value: unknown): boolean { return value === null || numberOrNull(value) !== null }
function paths(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(p => text(p) && !p.startsWith("/") && !p.includes("\\") && !p.includes("\0") && !p.split("/").includes("..") && p !== ".git" && !p.startsWith(".git/"))
}
function checks(value: unknown): value is Check[] {
  return Array.isArray(value) && value.every(c => record(c) && typeof c.id === "string" && /^[a-z0-9-]+$/.test(c.id) && Array.isArray(c.argv) && c.argv.length > 0 && c.argv.every(text) && Number.isInteger(c.timeoutMs) && c.timeoutMs > 0)
}
export function validateTask(value: unknown): Task {
  assert(record(value) && value.schemaVersion === 1, "Unsupported task schema")
  assert(text(value.id) && /^[a-z0-9-]+$/.test(value.id), "Invalid task id")
  assert(["trivial", "bugfix", "feature", "refactor", "integration"].includes(value.category), "Invalid category")
  assert(text(value.repository) && text(value.prompt), "repository and prompt required")
  assert(Number.isInteger(value.timeoutMs) && value.timeoutMs > 0, "Invalid timeout")
  assert(checks(value.setup) && record(value.verification) && checks(value.verification.commands), "Invalid checks")
  assert(paths(value.allowedFiles) && paths(value.forbiddenFiles) && paths(value.verification.expectedFiles), "Unsafe file paths")
  const ids = value.verification.commands.map((c: Check) => c.id)
  assert(ids.length > 0 && new Set(ids).size === ids.length, "Checks must be nonempty and unique")
  assert(Array.isArray(value.requirements) && value.requirements.length > 0 && value.requirements.every(r => record(r) && text(r.id) && Array.isArray(r.checks) && r.checks.length > 0 && r.checks.every((id: string) => ids.includes(id))), "Requirements need objective checks")
  assert(new Set(value.requirements.map((r: { id: string }) => r.id)).size === value.requirements.length, "Duplicate requirements")
  assert(value.successCriterion === "all-checks-and-scope", "Unsupported success criterion")
  if (value.repository === "fixture") {
    assert(record(value.initialFiles) && Object.values(value.initialFiles).every(v => typeof v === "string") && paths(Object.keys(value.initialFiles)), "Invalid fixture")
    assert(value.baseRevision === `sha256:${hash(value.initialFiles)}`, "Fixture revision does not match initial files")
  } else assert(typeof value.baseRevision === "string" && /^[a-f0-9]{40}$/.test(value.baseRevision), "Pin repository to full commit SHA")
  return value as unknown as Task
}
export function validateResult(value: unknown): Result {
  assert(record(value) && value.schemaVersion === 1, "Unsupported result schema")
  for (const key of ["runId", "pairId", "taskId", "model", "provider"]) assert(text(value[key]), `Missing ${key}`)
  assert(["build", "andmar"].includes(value.mode), "Invalid mode")
  assert(value.variant === null || text(value.variant), "Invalid variant")
  assert(Number.isInteger(value.repetition) && value.repetition >= 0, "Invalid repetition")
  assert(record(value.conditions) && Object.values(value.conditions).every(text), "Missing conditions")
  for (const key of ["startedAt", "finishedAt"]) assert(typeof value[key] === "string" && Number.isFinite(Date.parse(value[key])), `Invalid ${key}`)
  assert(Date.parse(value.finishedAt) >= Date.parse(value.startedAt), "Reversed timestamps")
  for (const key of ["durationMs", "agentDurationMs", "verificationDurationMs"]) assert(numberOrNull(value[key]) !== null, `Invalid ${key}`)
  for (const key of ["steps", "sessions", "subagents", "retries", "modelErrors", "userCorrections", "reworkCount"]) assert(metric(value[key]), `Invalid ${key}`)
  assert(record(value.tokens) && record(value.cost) && record(value.tools), "Missing usage")
  for (const key of ["input", "output", "reasoning", "cacheRead", "cacheWrite", "total"]) assert(metric(value.tokens[key]), `Invalid tokens.${key}`)
  const channels = [value.tokens.input, value.tokens.output, value.tokens.reasoning, value.tokens.cacheRead, value.tokens.cacheWrite]
  assert(value.tokens.total === sumMeasured(channels), "Token total must preserve unknown channels")
  for (const key of ["reported", "estimated"]) assert(metric(value.cost[key]), `Invalid cost.${key}`)
  for (const key of ["calls", "succeeded", "failed", "unfinished", "durationP50"]) assert(metric(value.tools[key]), `Invalid tools.${key}`)
  assert(value.exitStatus === null || Number.isInteger(value.exitStatus), "Invalid exit status")
  for (const key of ["timedOut", "comparable"]) assert(typeof value[key] === "boolean", `Invalid ${key}`)
  assert(value.error === null || typeof value.error === "string", "Invalid error")
  for (const key of ["changedFiles", "unexpectedFiles", "operationalFiles", "comparabilityIssues"]) assert(Array.isArray(value[key]) && value[key].every((v: unknown) => typeof v === "string"), `Invalid ${key}`)
  assert(record(value.verification) && typeof value.verification.passed === "boolean" && Array.isArray(value.verification.failedChecks) && value.verification.failedChecks.every(text) && Array.isArray(value.verification.checks), "Invalid verification")
  assert(value.verification.checks.every((c: any) => record(c) && text(c.id) && typeof c.passed === "boolean" && typeof c.timedOut === "boolean" && (c.exitStatus === null || Number.isInteger(c.exitStatus))), "Invalid check results")
  assert(value.verification.passed === (value.verification.failedChecks.length === 0 && value.verification.checks.every((c: any) => c.passed)), "Inconsistent verification result")
  assert(value.verification.checks.every((c: any) => c.passed === (c.exitStatus === 0 && !c.timedOut)), "Inconsistent check outcome")
  assert(record(value.requirements) && ["total", "satisfied", "missed"].every(k => Number.isInteger(value.requirements[k]) && value.requirements[k] >= 0) && value.requirements.total === value.requirements.satisfied + value.requirements.missed, "Invalid requirements")
  assert(record(value.quality) && typeof value.quality.taskSuccess === "boolean" && ["firstPassSuccess", "falseCompletion", "completionClaim"].every(k => value.quality[k] === null || typeof value.quality[k] === "boolean"), "Invalid quality")
  assert(metric(value.quality.userInterventions), "Invalid user interventions")
  assert(record(value.measurement) && text(value.measurement.source) && Array.isArray(value.measurement.warnings) && value.measurement.auxiliaryUsage === "unmeasured", "Missing measurement provenance")
  assert(record(value.contextPressure) && metric(value.contextPressure.peakPromptTokens) && metric(value.contextPressure.contextWindow) && metric(value.contextPressure.occupancyPct), "Invalid context metrics")
  assert(record(value.work) && metric(value.work.policyToolCalls), "Invalid work attribution")
  assert("developmentMetrics" in value && "ledgerMetrics" in value && "harness" in value, "Missing diagnostics")
  if (value.mode === "andmar") assert(record(value.harness) && ["version", "revision", "sourceHash"].every(k => text(value.harness[k])), "Missing harness identity")
  else assert(value.harness === null, "Build must not have a harness")
  const success = value.exitStatus === 0 && !value.timedOut && value.error === null && value.verification.passed && value.requirements.missed === 0 && value.unexpectedFiles.length === 0
  assert(value.quality.taskSuccess === success, "Inconsistent task success")
  assert(value.quality.firstPassSuccess !== true || success && value.userCorrections === 0, "Inconsistent first-pass success")
  assert(value.quality.falseCompletion === (value.quality.completionClaim === null ? null : value.quality.completionClaim && !success), "Inconsistent false completion")
  return value as Result
}
export function stableJson(value: unknown): string {
  const sort = (v: any): any => Array.isArray(v) ? v.map(sort) : record(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v
  return JSON.stringify(sort(value), null, 2) + "\n"
}
export function hash(value: unknown): string { return createHash("sha256").update(stableJson(value)).digest("hex") }
export function sumMeasured(values: Measured[]): Measured {
  return values.length === 0 || values.some(v => v === null) ? null : values.reduce<number>((a, b) => a + (b as number), 0)
}
export function emptyUsage(): Usage {
  return { tokens: { input: null, output: null, reasoning: null, cacheRead: null, cacheWrite: null, total: null }, cost: { reported: null, estimated: null }, steps: null, tools: { calls: null, succeeded: null, failed: null, unfinished: null, durationP50: null }, sessions: null, subagents: null, retries: null, modelErrors: null }
}
