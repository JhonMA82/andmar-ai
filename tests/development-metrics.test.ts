import test from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  applyDevelopmentEvent,
  developmentMetricsCapability,
  readLedgerMetrics,
} from "../src/capabilities/development-metrics/index.ts"
import type { SemanticEventInput, SemanticEventListener, SemanticObservability } from "../src/core/observability.ts"

function createMemoryState() {
  const map = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | undefined> { return map.get(key) as T | undefined },
    async set<T>(key: string, value: T): Promise<void> { map.set(key, value) },
    async remove(key: string): Promise<void> { map.delete(key) },
    async scan<T>(prefix: string): Promise<Array<{ key: string; value: T }>> {
      return [...map.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value: value as T }))
    },
  }
}

function createObservability(): SemanticObservability {
  const listeners = new Set<SemanticEventListener>()
  return {
    emit(event) { for (const listener of listeners) listener(event) },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
}

function createToolHarness(projectRoot: string) {
  const tools = new Map<string, any>()
  const ctx: any = {
    location: { directory: projectRoot, project: { canonical: projectRoot } },
    tool: {
      async transform(cb: (editor: any) => void) {
        cb({ namespace() {}, add(def: any) { tools.set(def.name, def) } })
        return { dispose() {} }
      },
    },
  }
  return { ctx, tools }
}

test("development metrics classify interventions, friction and value without content", () => {
  let metrics = applyDevelopmentEvent(undefined, {
    type: "andmar.intake",
    sessionID: "ses-1",
    payload: { action: "decision", mode: "enrich", needsRefinement: true, productDecisionMissing: false, source: "jev" },
  }, 1)
  metrics = applyDevelopmentEvent(metrics, {
    type: "andmar.verification",
    sessionID: "ses-1",
    payload: { action: "verify_revision", revision: "rev-a", requiredChecks: ["tests"], ok: false, unverifiedCount: 1 },
  }, 2)
  metrics = applyDevelopmentEvent(metrics, {
    type: "andmar.verification",
    sessionID: "ses-1",
    payload: { action: "verify_revision", revision: "rev-a", requiredChecks: ["tests"], ok: false, unverifiedCount: 1 },
  }, 3)
  metrics = applyDevelopmentEvent(metrics, {
    type: "andmar.review",
    sessionID: "ses-1",
    payload: { action: "timeout" },
  }, 4)
  metrics = applyDevelopmentEvent(metrics, {
    type: "andmar.completion",
    sessionID: "ses-1",
    payload: { ok: true, finalCompletion: true },
  }, 5)

  assert.equal(metrics.tasksObserved, 1)
  assert.equal(metrics.tasksCompleted, 1)
  assert.equal(metrics.interventions, 3)
  assert.equal(metrics.usefulInterventions, 3)
  assert.equal(metrics.frictions, 2)
  assert.equal(metrics.verification.staleEvidenceDetections, 2)
  assert.equal(metrics.verification.duplicateVerification, 1)
  assert.equal(metrics.review.timeouts, 1)
})

test("ledger metrics read only .andmar/work and derive rework/checkpoint recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "andmar-metrics-"))
  try {
    const ledger = join(root, ".andmar", "work", "demo")
    await mkdir(ledger, { recursive: true })
    await writeFile(join(ledger, "WORK.md"), `# Work — demo

Work ID: demo
Status: active
Mode: lightweight

## Work Units

- [x] WU-1 — first
  - Evidence: EV-1
  - Checkpoint: abcdef1234567890
- [~] WU-2 — second

## Lifecycle

- WU-1: active → done (EV-1); WU-2: pending → active
- WU-1: checkpoint abcdef123456 (verified 111111111111)
- WU-1: done → active — regression; previous checkpoint abcdef1234567890
- WU-1: active → done (EV-2); WU-2: pending → active
- WU-2: active → blocked — dependency
- WU-2: blocked → active — dependency restored
`)
    const metrics = await readLedgerMetrics(root)
    assert.equal(metrics.available, true)
    assert.equal(metrics.ledgers.total, 1)
    assert.equal(metrics.workUnits.total, 2)
    assert.equal(metrics.history.completionTransitions, 2)
    assert.equal(metrics.history.reopenEvents, 1)
    assert.equal(metrics.history.reopenedWorkUnits, 1)
    assert.equal(metrics.history.reopenedWithCheckpoint, 1)
    assert.equal(metrics.history.checkpointEvents, 1)
    assert.equal(metrics.rates.reworkRate, 0.5)
    assert.equal(metrics.rates.checkpointCoverage, 0.5)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("andmar_report aggregates semantic events and ledger snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "andmar-report-"))
  try {
    const state: any = createMemoryState()
    const observability = createObservability()
    const { ctx, tools } = createToolHarness(root)
    await developmentMetricsCapability.setup({
      ctx,
      state,
      observability,
      config: { developmentMetrics: { enabled: true } } as any,
    })

    observability.emit({
      type: "andmar.intake",
      sessionID: "ses-1",
      payload: { action: "decision", mode: "direct", needsRefinement: false, productDecisionMissing: false, source: "deterministic" },
    })
    observability.emit({
      type: "andmar.review",
      sessionID: "ses-1",
      payload: { action: "denied", reason: "terminal_attempt_same_state" },
    })

    const report = tools.get("report")
    assert.ok(report)
    const response = await report.execute({})
    const parsed = JSON.parse(response.content)
    assert.equal(parsed.enabled, true)
    assert.equal(parsed.totals.tasksObserved, 1)
    assert.equal(parsed.totals.frictions, 1)
    assert.equal(parsed.breakdown.review.unnecessaryRetriesPrevented, 1)
    assert.equal(parsed.rates.harnessFrictionRate, 1)
    assert.deepEqual(parsed.coverage.notYetMeasured.length, 3)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
