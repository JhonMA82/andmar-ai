import { emptyUsage, numberOrNull, record, sumMeasured, assert, type Usage, type Measured } from "./schema.ts"

export interface Pricing {
  schemaVersion: 1
  provider: string
  model: string
  variant: string | null
  currency: "USD"
  asOf: string
  source: string
  perMillion: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }
}
export function validatePricing(p: unknown): Pricing {
  assert(record(p) && p.schemaVersion === 1 && p.currency === "USD", "Invalid pricing schema")
  assert(["provider", "model", "source", "asOf"].every(k => typeof p[k] === "string" && p[k].length > 0), "Pricing needs provenance and exact model")
  assert(p.variant === null || typeof p.variant === "string" && p.variant.trim().length > 0, "Pricing needs an explicit variant (string or null)")
  assert(record(p.perMillion) && ["input", "output", "reasoning", "cacheRead", "cacheWrite"].every(k => numberOrNull(p.perMillion[k]) !== null), "Missing token rates")
  return p as Pricing
}
export function assertPricingMatches(pricing: Pricing | null, selected: { provider: string; model: string; variant: string | null }): void {
  if (!pricing) return
  validatePricing(pricing)
  assert(pricing.provider === selected.provider && pricing.model === selected.model && pricing.variant === selected.variant,
    `Pricing must match exact provider/model/variant: selected ${selected.provider}/${selected.model} variant=${JSON.stringify(selected.variant)}, pricing ${pricing.provider}/${pricing.model} variant=${JSON.stringify(pricing.variant)}`)
}
export function estimateCost(usage: Usage, pricing: Pricing | null): Measured {
  if (!pricing) return null
  const keys = ["input", "output", "reasoning", "cacheRead", "cacheWrite"] as const
  return sumMeasured(keys.map(k => usage.tokens[k] === null ? null : usage.tokens[k]! * pricing.perMillion[k] / 1_000_000))
}

/** OpenCode V2 SessionStats.Info. Never infer absent fields as zero. */
export function parseStats(raw: unknown): { usage: Usage; warnings: string[]; models: unknown[]; policyToolCalls: Measured } {
  const usage = emptyUsage()
  const warnings: string[] = []
  const data = record(raw) && record(raw.data) ? raw.data : raw
  if (!record(data) || !record(data.tokens)) return { usage, warnings: ["Unsupported or missing OpenCode stats schema"], models: [], policyToolCalls: null }
  const tokens = data.tokens
  usage.tokens = {
    input: numberOrNull(tokens.input), output: numberOrNull(tokens.output), reasoning: numberOrNull(tokens.reasoning),
    cacheRead: numberOrNull(tokens.cache?.read), cacheWrite: numberOrNull(tokens.cache?.write), total: null,
  }
  usage.tokens.total = sumMeasured([usage.tokens.input, usage.tokens.output, usage.tokens.reasoning, usage.tokens.cacheRead, usage.tokens.cacheWrite])
  usage.cost.reported = numberOrNull(data.cost)
  usage.steps = numberOrNull(data.steps)
  usage.sessions = numberOrNull(data.sessions)
  usage.subagents = numberOrNull(data.subagents)
  const tools = record(data.tools) ? data.tools : {}
  const totals = record(tools.totals) ? tools.totals : {}
  usage.tools = { calls: numberOrNull(totals.calls), succeeded: numberOrNull(totals.succeeded), failed: numberOrNull(totals.failed), unfinished: numberOrNull(totals.unfinished), durationP50: null }
  // Per-tool medians cannot be averaged into a global median.
  let policyToolCalls: Measured = null
  if (tools.mode === "detail" && Array.isArray(tools.usage)) {
    policyToolCalls = tools.usage.filter((t: any) => typeof t.name === "string" && /^andmar[_.]/.test(t.name)).reduce((n: number, t: any) => n + (numberOrNull(t.calls) ?? 0), 0)
  }
  if (usage.tokens.total === null) warnings.push("Incomplete native token channels; total is unmeasured")
  return { usage, warnings, models: Array.isArray(data.models) ? data.models : [], policyToolCalls }
}

export interface TranscriptDiagnostics {
  retries: Measured
  modelErrors: Measured
  durationP50: Measured
  peakPromptTokens: Measured
  userCorrections: Measured
  completionClaim: boolean | null
  developmentMetrics: unknown
  modelRefs: { providerID: string; id: string; variant?: string }[]
  andmarObserved: boolean
}
/** Only complete native V2 session exports, including descendants, are accepted. */
export function collectTranscripts(raw: unknown[], complete: boolean): TranscriptDiagnostics {
  const result: TranscriptDiagnostics = { retries: null, modelErrors: null, durationP50: null, peakPromptTokens: null, userCorrections: null, completionClaim: null, developmentMetrics: null, modelRefs: [], andmarObserved: false }
  const messages = new Map<string, any>()
  const tools = new Map<string, any>()
  const refs = new Map<string, any>()
  let userCount = 0
  let retries = 0
  let modelErrors = 0
  let allDurations = true
  const durations: number[] = []
  for (const value of raw) {
    const data = record(value) && record(value.data) ? value.data : value
    if (!record(data) || !record(data.info) || !Array.isArray(data.messages)) { complete = false; continue }
    if (record(data.info.model) && typeof data.info.model.providerID === "string" && typeof data.info.model.id === "string") refs.set(JSON.stringify(data.info.model), data.info.model)
    for (const m of data.messages) if (record(m) && typeof m.id === "string") messages.set(`${data.info.id}:${m.id}`, { ...m, sessionID: data.info.id, parentID: data.info.parentID })
  }
  for (const m of messages.values()) {
    if (m.type === "user" && !m.parentID) userCount++
    if (m.type !== "assistant") continue
    if (record(m.error)) modelErrors++
    if (record(m.model) && typeof m.model.providerID === "string" && typeof m.model.id === "string") refs.set(JSON.stringify(m.model), m.model)
    if (record(m.retry)) {
      const attempt = numberOrNull(m.retry.attempt)
      if (attempt === null) complete = false
      else retries += attempt
    }
    if (record(m.tokens)) {
      const prompt = sumMeasured([numberOrNull(m.tokens.input), numberOrNull(m.tokens.cache?.read), numberOrNull(m.tokens.cache?.write)])
      if (prompt !== null) result.peakPromptTokens = Math.max(result.peakPromptTokens ?? 0, prompt)
    }
    for (const t of Array.isArray(m.content) ? m.content : []) if (t.type === "tool" && typeof t.id === "string") tools.set(`${m.sessionID}:${t.id}`, t)
  }
  for (const t of tools.values()) {
    if (typeof t.name === "string" && /^andmar[_.]/.test(t.name)) result.andmarObserved = true
    if (["completed", "error"].includes(t.state?.status)) {
      const start = numberOrNull(t.time?.ran)
      const end = numberOrNull(t.time?.completed)
      if (start === null || end === null || end < start) allDurations = false
      else durations.push(end - start)
    }
    if (t.state?.status !== "completed") continue
    const content = t.state.content
    const texts = Array.isArray(content) ? content.filter((c: any) => c.type === "text").map((c: any) => c.text) : []
    for (const text of texts) {
      let v: any
      try { v = JSON.parse(text) } catch { continue }
      if (/^andmar[_.]report$/.test(t.name) && record(v)) result.developmentMetrics = v
      if (/^andmar[_.]completion_gate$/.test(t.name) && typeof v?.ok === "boolean") result.completionClaim = v.ok
    }
  }
  // A deterministic gate claim is objective. Natural-language claims require annotation.
  result.modelRefs = [...refs.values()]
  if (complete) {
    result.retries = retries
    result.modelErrors = modelErrors
    result.userCorrections = userCount > 0 ? Math.max(0, userCount - 1) : null
    if (allDurations && durations.length > 0) {
      durations.sort((a, b) => a - b)
      const mid = Math.floor(durations.length / 2)
      result.durationP50 = durations.length % 2 ? durations[mid]! : (durations[mid - 1]! + durations[mid]!) / 2
    }
  }
  return result
}
