// Generic OpenRouter Decisions transport shared by AndMar decision surfaces.
// No capability imports and no plugin-API dependency.

export const JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
export const DEFAULT_JEV_MODEL = "typesafe/jev-1.13"
export const DEFAULT_JEV_TIMEOUT_MS = 8_000
export const MAX_STATE_CHARS = 8_000

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
}>

export interface JevQuestionShape {
  type: string
  instructions: string
  criteria?: unknown
}

export interface JevCallOptions {
  model?: string
  apiKey: string
  timeoutMs?: number
  fetchFn?: FetchFn
  questions: Record<string, JevQuestionShape>
}

export type RawAnswers = Record<string, Record<string, unknown>>

export interface JevSuccess {
  answers: RawAnswers
  modelReturned: string
  latencyMs: number
}

function defaultFetch(): FetchFn {
  const impl = (globalThis as { fetch?: unknown }).fetch
  if (typeof impl !== "function") throw new Error("fetch is not available in this runtime")
  const fn = impl as (url: string, init: Record<string, unknown>) => Promise<{
    ok: boolean
    status: number
    json(): Promise<unknown>
    text(): Promise<string>
  }>
  return (url, init) => fn(url, init as Record<string, unknown>)
}

export function readApiKey(): string {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.["OPENROUTER_API_KEY"]
  return typeof value === "string" ? value.trim() : ""
}

export function truncateState(state: string, max: number = MAX_STATE_CHARS): string {
  if (state.length <= max) return state
  return `${state.slice(0, max)}\n…[truncated by AndMar AI decision transport: ${state.length - max} chars omitted]`
}

function redact(text: string): string {
  return text.length > 500 ? `${text.slice(0, 500)}…[truncated]` : text
}

export async function callJevDecision(state: string, options: JevCallOptions): Promise<JevSuccess> {
  const started = Date.now()
  if (options.apiKey.trim() === "") {
    const err = new Error("missing_api_key") as Error & { code?: string }
    err.code = "missing_api_key"
    throw err
  }
  const model = options.model ?? DEFAULT_JEV_MODEL
  const timeoutMs = options.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS
  const fetchFn = options.fetchFn ?? defaultFetch()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const body = JSON.stringify({ model, state: truncateState(state), questions: options.questions })
    let response: { ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }
    try {
      response = await fetchFn(JEV_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
        body,
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        const timeout = new Error("timeout") as Error & { code?: string }
        timeout.code = "timeout"
        throw timeout
      }
      const failed = new Error("request_failed") as Error & { code?: string }
      failed.code = "request_failed"
      throw failed
    }
    if (!response.ok) {
      let detail = ""
      try { detail = redact(await response.text()) } catch { detail = "" }
      const failed = new Error(`request_failed:${response.status}${detail !== "" ? `:${detail}` : ""}`) as Error & { code?: string }
      failed.code = response.status === 401 || response.status === 403 ? "auth_failed" : "request_failed"
      throw failed
    }
    let payload: unknown
    try { payload = await response.json() } catch {
      const invalid = new Error("invalid_response") as Error & { code?: string }
      invalid.code = "invalid_response"
      throw invalid
    }
    const answers = (payload as { answers?: unknown })?.answers
    if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
      const invalid = new Error("invalid_response") as Error & { code?: string }
      invalid.code = "invalid_response"
      throw invalid
    }
    const modelReturned = typeof (payload as { model?: unknown }).model === "string" ? (payload as { model: string }).model : model
    return { answers: answers as RawAnswers, modelReturned, latencyMs: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}
