// Intake-specific wrapper over the shared OpenRouter Decisions transport.

import {
  callJevDecision,
  DEFAULT_JEV_MODEL,
  DEFAULT_JEV_TIMEOUT_MS,
  JEV_ENDPOINT,
  MAX_STATE_CHARS,
  readApiKey,
  truncateState,
  type FetchFn,
  type RawAnswers,
  type JevSuccess,
} from "../../core/jev-client.ts"
import { INTAKE_QUESTIONS, type JevQuestion } from "./questions.ts"

export { DEFAULT_JEV_MODEL, DEFAULT_JEV_TIMEOUT_MS, JEV_ENDPOINT, MAX_STATE_CHARS, readApiKey, truncateState }
export type { FetchFn, RawAnswers, JevSuccess }

export interface JevCallOptions {
  model?: string
  apiKey: string
  timeoutMs?: number
  fetchFn?: FetchFn
  questions?: Record<string, JevQuestion>
}

export function resolveJevModel(configModel?: unknown): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.["ANDMAR_INTAKE_MODEL"]
  if (typeof configModel === "string" && configModel.trim() !== "") return configModel.trim()
  if (typeof env === "string" && env.trim() !== "") return env.trim()
  return DEFAULT_JEV_MODEL
}

export function resolveJevTimeout(configTimeout?: unknown): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.["ANDMAR_INTAKE_TIMEOUT_MS"]
  const fromConfig = typeof configTimeout === "number" && Number.isFinite(configTimeout) ? configTimeout : undefined
  const fromEnv = env !== undefined && env.trim() !== "" ? Number(env) : undefined
  const value = fromConfig ?? (fromEnv !== undefined && Number.isFinite(fromEnv) ? fromEnv : DEFAULT_JEV_TIMEOUT_MS)
  if (!Number.isFinite(value)) return DEFAULT_JEV_TIMEOUT_MS
  return Math.min(Math.max(Math.round(value as number), 1_000), 60_000)
}

export async function callJev(state: string, options: JevCallOptions): Promise<JevSuccess> {
  return callJevDecision(state, {
    ...options,
    questions: (options.questions ?? INTAKE_QUESTIONS) as Record<string, JevQuestion>,
  })
}
