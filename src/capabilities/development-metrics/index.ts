import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Capability, StateStore } from "../../core/contracts.ts"
import type { SemanticEventInput } from "../../core/observability.ts"

const METRICS_KEY = "development-metrics/v1/aggregate"
const MAX_LEDGERS = 100

export interface DevelopmentMetricsState {
  version: 1
  startedAt: number
  updatedAt: number
  tasksObserved: number
  tasksCompleted: number
  interventions: number
  usefulInterventions: number
  frictions: number
  activity: {
    intake: number
    routing: number
    delegation: number
    verification: number
    completion: number
    contract: number
    runtime: number
  }
  intake: {
    enrich: number
    structure: number
    refinements: number
    productDecisionsMissing: number
    fallbacks: number
  }
  verification: {
    invalidEvidencePrevented: number
    blockedRevisions: number
    staleEvidenceDetections: number
    duplicateVerification: number
  }
  completion: {
    blocked: number
    completed: number
  }
  runtime: {
    capabilityErrors: number
    delegationFailures: number
  }
  memory: {
    calls: number
    context: number
    searches: number
    reads: number
    saves: number
    crossProjectCalls: number
    failures: number
  }
  lastVerificationKey?: string
}

function emptyMetrics(now = Date.now()): DevelopmentMetricsState {
  return {
    version: 1,
    startedAt: now,
    updatedAt: now,
    tasksObserved: 0,
    tasksCompleted: 0,
    interventions: 0,
    usefulInterventions: 0,
    frictions: 0,
    activity: { intake: 0, routing: 0, delegation: 0, verification: 0, completion: 0, contract: 0, runtime: 0 },
    intake: { enrich: 0, structure: 0, refinements: 0, productDecisionsMissing: 0, fallbacks: 0 },
    verification: { invalidEvidencePrevented: 0, blockedRevisions: 0, staleEvidenceDetections: 0, duplicateVerification: 0 },
    completion: { blocked: 0, completed: 0 },
    runtime: { capabilityErrors: 0, delegationFailures: 0 },
    memory: { calls: 0, context: 0, searches: 0, reads: 0, saves: 0, crossProjectCalls: 0, failures: 0 },
  }
}

function bool(value: unknown): boolean {
  return value === true
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function string(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function intervention(metrics: DevelopmentMetricsState, useful = true): void {
  metrics.interventions += 1
  if (useful) metrics.usefulInterventions += 1
}

/** Apply one metadata-only semantic event to the bounded aggregate. */
export function applyDevelopmentEvent(
  current: DevelopmentMetricsState | undefined,
  event: SemanticEventInput,
  now = Date.now(),
): DevelopmentMetricsState {
  const base = emptyMetrics(current?.startedAt ?? now)
  const next: DevelopmentMetricsState = current
    ? {
        ...base,
        ...current,
        activity: { ...base.activity, ...(current.activity ?? {}) },
        intake: { ...base.intake, ...(current.intake ?? {}) },
        verification: { ...base.verification, ...(current.verification ?? {}) },
        completion: { ...base.completion, ...(current.completion ?? {}) },
        runtime: { ...base.runtime, ...(current.runtime ?? {}) },
        memory: { ...base.memory, ...(current.memory ?? {}) },
      }
    : base
  next.updatedAt = now
  const payload = event.payload
  const activityKey = event.type.replace("andmar.", "") as keyof DevelopmentMetricsState["activity"]
  if (activityKey in next.activity) next.activity[activityKey] += 1

  if (event.type === "andmar.intake" && payload.action === "decision") {
    next.tasksObserved += 1
    const mode = string(payload.mode)
    if (mode === "enrich") next.intake.enrich += 1
    if (mode === "structure") next.intake.structure += 1
    if (bool(payload.needsRefinement)) next.intake.refinements += 1
    if (bool(payload.productDecisionMissing)) next.intake.productDecisionsMissing += 1
    if (payload.source === "fallback") next.intake.fallbacks += 1
    if (mode !== "direct" || bool(payload.needsRefinement) || bool(payload.productDecisionMissing)) {
      intervention(next, true)
    }
  }

  if (event.type === "andmar.verification") {
    const action = string(payload.action)
    if (action === "receipt_rejected") {
      next.verification.invalidEvidencePrevented += 1
      intervention(next, true)
    }
    if (action === "verify_revision") {
      const revision = string(payload.revision)
      const checks = Array.isArray(payload.requiredChecks) ? payload.requiredChecks.join(",") : ""
      const key = revision === "" ? "" : `${revision}|${checks}`
      if (key !== "" && next.lastVerificationKey === key) {
        next.verification.duplicateVerification += 1
        next.frictions += 1
      }
      if (key !== "") next.lastVerificationKey = key
      if (!bool(payload.ok)) {
        next.verification.blockedRevisions += 1
        if (number(payload.unverifiedCount) > 0) next.verification.staleEvidenceDetections += 1
        intervention(next, true)
      }
    }
  }

  if (event.type === "andmar.completion") {
    if (bool(payload.finalCompletion)) {
      next.tasksCompleted += 1
      next.completion.completed += 1
    } else if (payload.ok === false) {
      next.completion.blocked += 1
      intervention(next, true)
    }
  }

  if (event.type === "andmar.delegation" && payload.phase === "failed") {
    next.runtime.delegationFailures += 1
    next.frictions += 1
  }

  if (event.type === "andmar.runtime" && payload.action === "capability_error") {
    next.runtime.capabilityErrors += 1
    next.frictions += 1
  }

  if (event.type === "andmar.runtime" && payload.action === "engram_memory_call") {
    next.memory.calls += 1
    const operation = string(payload.operation)
    if (operation === "mem_context") next.memory.context += 1
    if (operation === "mem_search") next.memory.searches += 1
    if (operation === "mem_get_observation") next.memory.reads += 1
    if (["mem_save", "mem_update", "mem_session_summary", "mem_capture_passive"].includes(operation)) next.memory.saves += 1
    if (bool(payload.crossProject)) next.memory.crossProjectCalls += 1
    if (payload.status !== "completed") {
      next.memory.failures += 1
      next.frictions += 1
    }
  }

  return next
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10_000) / 10_000
}

interface LedgerMetrics {
  available: boolean
  ledgers: { total: number; active: number; blocked: number; completed: number; truncated: boolean }
  workUnits: { total: number; pending: number; active: number; blocked: number; done: number }
  history: {
    completionTransitions: number
    reopenEvents: number
    reopenedWorkUnits: number
    blockEvents: number
    resumeEvents: number
    checkpointEvents: number
    reopenedWithCheckpoint: number
  }
  rates: { reworkRate: number | null; checkpointCoverage: number | null }
  readErrors: number
}

function emptyLedgerMetrics(): LedgerMetrics {
  return {
    available: false,
    ledgers: { total: 0, active: 0, blocked: 0, completed: 0, truncated: false },
    workUnits: { total: 0, pending: 0, active: 0, blocked: 0, done: 0 },
    history: { completionTransitions: 0, reopenEvents: 0, reopenedWorkUnits: 0, blockEvents: 0, resumeEvents: 0, checkpointEvents: 0, reopenedWithCheckpoint: 0 },
    rates: { reworkRate: null, checkpointCoverage: null },
    readErrors: 0,
  }
}

export async function readLedgerMetrics(projectRoot: string | undefined): Promise<LedgerMetrics> {
  const result = emptyLedgerMetrics()
  if (!projectRoot) return result
  const workRoot = join(projectRoot, ".andmar", "work")
  let entries
  try {
    entries = (await readdir(workRoot, { withFileTypes: true })).filter((entry: { isDirectory(): boolean }) => entry.isDirectory())
  } catch {
    return result
  }
  result.available = true
  result.ledgers.truncated = entries.length > MAX_LEDGERS
  entries = entries.slice(0, MAX_LEDGERS)
  const reopened = new Set<string>()

  for (const entry of entries) {
    let content: string
    try {
      content = await readFile(join(workRoot, entry.name, "WORK.md"), "utf8")
    } catch {
      result.readErrors += 1
      continue
    }
    result.ledgers.total += 1
    const status = content.match(/^(?:Status|status):\s*([^\s]+)\s*$/mi)?.[1]?.toLowerCase()
    if (status === "completed") result.ledgers.completed += 1
    else if (status === "blocked") result.ledgers.blocked += 1
    else result.ledgers.active += 1

    for (const match of content.matchAll(/^-\s*\[([ ~x!])\]\s*(WU-\d+|W\d+)\b/gmi)) {
      result.workUnits.total += 1
      if (match[1] === "x") result.workUnits.done += 1
      else if (match[1] === "!") result.workUnits.blocked += 1
      else if (match[1] === "~") result.workUnits.active += 1
      else result.workUnits.pending += 1
    }

    for (const match of content.matchAll(/\b(WU-\d+|W\d+):\s*active\s*→\s*done\b/gi)) {
      result.history.completionTransitions += 1
    }
    for (const match of content.matchAll(/\b(WU-\d+|W\d+):\s*done\s*→\s*active\b([^\n]*)/gi)) {
      result.history.reopenEvents += 1
      reopened.add(`${entry.name}:${match[1]?.toUpperCase()}`)
      if (/previous checkpoint\s+[0-9a-f]{7,40}/i.test(match[2] ?? "")) result.history.reopenedWithCheckpoint += 1
    }
    result.history.blockEvents += (content.match(/:\s*active\s*→\s*blocked\b/gi) ?? []).length
    result.history.resumeEvents += (content.match(/:\s*blocked\s*→\s*active\b/gi) ?? []).length
    result.history.checkpointEvents += (content.match(/:\s*checkpoint\s+[0-9a-f]{7,40}\b/gi) ?? []).length
  }

  result.history.reopenedWorkUnits = reopened.size
  result.rates.reworkRate = rate(result.history.reopenEvents, result.history.completionTransitions)
  result.rates.checkpointCoverage = rate(result.history.checkpointEvents, result.history.completionTransitions)
  return result
}

export const developmentMetricsCapability: Capability = {
  id: "development-metrics",
  version: 1,
  description: "Bounded local metrics for AndMar intervention, friction, value and recovery during development.",
  async setup({ ctx, config, state, observability }) {
    let pending = Promise.resolve()
    const enabled = config.developmentMetrics.enabled
    const unsubscribe = enabled && observability
      ? observability.subscribe((event) => {
          pending = pending
            .then(async () => {
              const current = await state.get<DevelopmentMetricsState>(METRICS_KEY)
              await state.set(METRICS_KEY, applyDevelopmentEvent(current, event))
            })
            .catch(() => undefined)
        })
      : undefined

    const registration = await ctx.tool.transform((editor: any) => {
      editor.namespace({ name: "andmar", description: "AndMar AI harness primitives" })
      editor.add({
        name: "report",
        description: "Report bounded local development metrics for AndMar: intervention, friction, useful interventions, Work Ledger rework and checkpoint recovery. Metadata only; no prompts, code, commands or tool output are stored.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { namespace: "andmar", codemode: true },
        execute: async () => {
          await pending
          const metrics = (await state.get<DevelopmentMetricsState>(METRICS_KEY)) ?? emptyMetrics()
          const projectRoot = ctx.location?.project?.canonical ?? ctx.location?.directory
          const ledger = await readLedgerMetrics(typeof projectRoot === "string" ? projectRoot : undefined)
          return {
            content: JSON.stringify({
              enabled,
              window: { startedAt: metrics.startedAt, updatedAt: metrics.updatedAt },
              totals: {
                tasksObserved: metrics.tasksObserved,
                tasksCompleted: metrics.tasksCompleted,
                interventions: metrics.interventions,
                usefulInterventions: metrics.usefulInterventions,
                frictions: metrics.frictions,
              },
              rates: {
                harnessInterventionRate: rate(metrics.interventions, metrics.tasksObserved),
                harnessFrictionRate: rate(metrics.frictions, metrics.tasksObserved),
                usefulInterventionRate: rate(metrics.usefulInterventions, metrics.interventions),
              },
              capabilityActivity: metrics.activity,
              breakdown: {
                intake: metrics.intake,
                verification: metrics.verification,
                completion: metrics.completion,
                runtime: metrics.runtime,
                memory: metrics.memory,
              },
              workLedger: ledger,
              recovery: {
                reopenedWorkUnits: ledger.history.reopenedWorkUnits,
                reopenEvents: ledger.history.reopenEvents,
                checkpointProtectedReopens: ledger.history.reopenedWithCheckpoint,
                unprotectedReopens: Math.max(0, ledger.history.reopenEvents - ledger.history.reopenedWithCheckpoint),
                reworkRate: ledger.rates.reworkRate,
                checkpointCoverage: ledger.rates.checkpointCoverage,
              },
              coverage: {
                measured: [
                  "interventions/tasks",
                  "friction/tasks",
                  "useful interventions/interventions",
                  "reopened/completed work-unit transitions",
                  "checkpoint/completed work-unit transitions",
                  "invalid verification evidence prevention",
                  "Engram memory call volume/failures/cross-project usage (metadata only)",
                ],
                notYetMeasured: [
                  "false-block classification requires human ground truth",
                  "duplicate-work attempts refused before ledger mutation",
                  "commits reverted and independent work lost after regression",
                ],
              },
            }, null, 2),
          }
        },
      })
    })

    return () => {
      unsubscribe?.()
      if (registration?.dispose) void registration.dispose()
    }
  },
}

export default developmentMetricsCapability
