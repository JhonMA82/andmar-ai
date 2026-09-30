import { readFile, readdir } from "node:fs/promises"
import { resolve, join } from "node:path"
import { pathToFileURL } from "node:url"
import { assert, hash, stableJson, sumMeasured, validateResult, type Measured, type Result } from "./schema.ts"

export function deltaPct(baseline: Measured, current: Measured): Measured {
  if (baseline === null || current === null || baseline === 0) return null
  return Math.round((current - baseline) / baseline * 100_000) / 1000
}
export function costPerSuccess(cost: Measured, successes: number): Measured {
  return cost === null || successes === 0 ? null : cost / successes
}
export function summarize(runs: Result[]) {
  const sum = (get: (r: Result) => Measured) => sumMeasured(runs.map(get))
  const successes = runs.filter(r => r.quality.taskSuccess).length
  const reportedCost = sum(r => r.cost.reported)
  const estimatedCost = sum(r => r.cost.estimated)
  return {
    runs: runs.length, successfulTasks: successes,
    firstPassSuccess: sum(r => r.quality.firstPassSuccess === null ? null : Number(r.quality.firstPassSuccess)),
    falseCompletion: sum(r => r.quality.falseCompletion === null ? null : Number(r.quality.falseCompletion)),
    falseCompletionMeasured: runs.filter(r => r.quality.falseCompletion !== null).length,
    verificationSuccess: runs.filter(r => r.verification.passed).length,
    requirementsMissed: sum(r => r.requirements.missed), unexpectedChanges: sum(r => r.unexpectedFiles.length),
    tokens: sum(r => r.tokens.total), reportedCost, estimatedCost,
    durationMs: sum(r => r.durationMs), tools: sum(r => r.tools.calls), steps: sum(r => r.steps),
    retries: sum(r => r.retries), subagents: sum(r => r.subagents),
    modelErrors: sum(r => r.modelErrors), userInterventions: sum(r => r.quality.userInterventions),
    cacheRead: sum(r => r.tokens.cacheRead), cacheWrite: sum(r => r.tokens.cacheWrite),
    rework: sum(r => r.reworkCount), userCorrections: sum(r => r.userCorrections),
    reportedCostPerSuccess: costPerSuccess(reportedCost, successes), estimatedCostPerSuccess: costPerSuccess(estimatedCost, successes),
  }
}
export function compare(baselineInput: Result[], currentInput: Result[]) {
  const sort = (runs: Result[]) => [...runs].map(validateResult).sort((a, b) => a.taskId.localeCompare(b.taskId) || a.repetition - b.repetition)
  const baseline = sort(baselineInput)
  const current = sort(currentInput)
  assert(baseline.length > 0 && baseline.length === current.length, "Need equal nonempty paired samples")
  const key = (r: Result) => `${r.taskId}:${r.repetition}`
  assert(new Set(baseline.map(key)).size === baseline.length && new Set(current.map(key)).size === current.length, "Duplicate task/repetition; select one cohort")
  assert(new Set([...baseline, ...current].map(r => `${r.provider}/${r.model}#${r.variant ?? ""}`)).size === 1, "Mixed models or variants")
  const pairs = baseline.map((b, i) => {
    const c = current[i]!
    assert(key(b) === key(c), "Unmatched tasks/repetitions")
    assert(b.comparable && c.comparable, `Run is not comparable: ${b.runId}/${c.runId}`)
    assert(hash(b.conditions) === hash(c.conditions), `Different execution conditions: ${key(b)}`)
    return {
      taskId: b.taskId, repetition: b.repetition, baselineRunId: b.runId, currentRunId: c.runId,
      tokenOverheadPct: deltaPct(b.tokens.total, c.tokens.total), durationOverheadPct: deltaPct(b.durationMs, c.durationMs),
      toolCallOverheadPct: deltaPct(b.tools.calls, c.tools.calls), stepOverheadPct: deltaPct(b.steps, c.steps),
    }
  })
  const b = summarize(baseline)
  const c = summarize(current)
  const deltas = Object.fromEntries(Object.keys(b).filter(k => k !== "runs").map(k => [k, deltaPct(b[k as keyof typeof b], c[k as keyof typeof c])]))
  return {
    schemaVersion: 1,
    model: `${baseline[0]!.provider}/${baseline[0]!.model}${baseline[0]!.variant ? `#${baseline[0]!.variant}` : ""}`,
    baselineIdentity: [...new Set(baseline.map(r => r.harness ? `andmar ${r.harness.version}@${r.harness.sourceHash}` : "build"))].sort(),
    currentIdentity: [...new Set(current.map(r => r.harness ? `andmar ${r.harness.version}@${r.harness.sourceHash}` : "build"))].sort(),
    baseline: b, current: c, deltaPct: deltas, pairs,
    overhead: { tokenOverheadPct: deltas.tokens, durationOverheadPct: deltas.durationMs, toolCallOverheadPct: deltas.tools, stepOverheadPct: deltas.steps },
    notes: ["Cost per success includes costs of failed tasks. Unknown samples make an aggregate null.", "Native reported cost is provider-accounted USD, not an independently audited invoice.", "False completion requires a deterministic gate claim or a documented human annotation.", "Provider cache warmth, network latency and stochastic model output cannot be fixed; repeat and alternate order."],
  }
}
export function humanReport(report: ReturnType<typeof compare>): string {
  const rows: [string, keyof ReturnType<typeof summarize>][] = [
    ["Successful tasks", "successfulTasks"], ["First-pass success", "firstPassSuccess"], ["False completion", "falseCompletion"],
    ["Verification success", "verificationSuccess"], ["Requirements missed", "requirementsMissed"], ["Unexpected changes", "unexpectedChanges"],
    ["Tokens", "tokens"], ["Reported cost (USD)", "reportedCost"], ["Estimated API cost (USD)", "estimatedCost"],
    ["Duration (ms)", "durationMs"], ["Tool calls", "tools"], ["Steps", "steps"], ["Retries", "retries"], ["Subagents", "subagents"],
    ["Model errors", "modelErrors"], ["Cache read", "cacheRead"], ["Cache write", "cacheWrite"], ["Rework", "rework"], ["User corrections", "userCorrections"], ["User interventions", "userInterventions"],
    ["Reported cost/success", "reportedCostPerSuccess"], ["Estimated cost/success", "estimatedCostPerSuccess"],
  ]
  const format = (v: Measured) => v === null ? "unmeasured" : Number.isInteger(v) ? String(v) : v.toFixed(6)
  const lines = rows.map(([label, key]) => {
    const d = report.deltaPct[key]
    return `${label.padEnd(28)} ${format(report.baseline[key]).padStart(14)} ${format(report.current[key]).padStart(14)} ${(d === null || d === undefined ? "unmeasured" : `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`).padStart(12)}`
  })
  return [`Benchmark: ${report.baselineIdentity.join(", ")} vs ${report.currentIdentity.join(", ")}`, `Model: ${report.model}`, `Runs per cohort: ${report.baseline.runs}`, "Metric                             Baseline        Current        Delta", ...lines, ...report.notes].join("\n") + "\n"
}
export async function loadResults(directory: string): Promise<Result[]> {
  const results: Result[] = []
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) results.push(...await loadResults(path))
    else if (entry.name.endsWith(".result.json")) results.push(validateResult(JSON.parse(await readFile(path, "utf8"))))
  }
  return results
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    const option = (name: string) => args[args.indexOf(name) + 1]
    assert(args.includes("--baseline") && args.includes("--current"), "Usage: bun bench/compare.ts --baseline DIR --current DIR [--json]")
    const report = compare(await loadResults(resolve(option("--baseline")!)), await loadResults(resolve(option("--current")!)))
    process.stdout.write(args.includes("--json") ? stableJson(report) : humanReport(report))
  } catch (e) { console.error((e as Error).message); process.exitCode = 1 }
}
