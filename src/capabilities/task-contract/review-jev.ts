import type { ChangeKind } from "../../core/contracts.ts"
import {
  callJevDecision,
  DEFAULT_JEV_MODEL,
  readApiKey,
  type FetchFn,
  type RawAnswers,
} from "../../core/jev-client.ts"
import type { ReviewMode, TaskContract } from "../../core/task-contract.ts"

const DEFAULT_REVIEW_JEV_TIMEOUT_MS = 5_000
const JEV_REVIEW_KINDS = new Set<ChangeKind>(["feature", "bugfix", "refactor", "debug"])

const REVIEW_QUESTIONS = {
  semantic_scope: {
    type: "choice",
    instructions: "How broad is the semantic impact of the implemented change, based only on the supplied goal, requirement statuses and changed paths?",
    criteria: {
      localized: "The behavior is localized to one bounded concern or subsystem.",
      cross_cutting: "The behavior crosses multiple modules/subsystems or has interactions that need broader semantic inspection.",
      critical: "The change affects trust, compatibility, persistent data, authorization, public contracts or another critical boundary.",
    },
  },
  external_contract_risk: {
    type: "noul",
    instructions: "Does semantic correctness materially depend on an external/runtime contract that deserves broader inspection?",
    criteria: {
      true: "Correctness depends on an external API/provider/runtime/compatibility boundary or a public contract.",
      false: "The change is self-contained enough for a bounded evidence audit.",
    },
  },
  evidence_sufficiency: {
    type: "noul",
    instructions: "Is the supplied human-readable verification summary plausibly sufficient for an independent semantic audit without recreating verification?",
    criteria: {
      true: "The summary names relevant checks/smokes and their outcomes at the final revision.",
      false: "The summary is missing, stale, vague, or does not cover the claimed behavior.",
    },
  },
  review_depth: {
    type: "choice",
    instructions: "Choose the independent review depth. Never choose less than audit. Deep means inspect more semantic context, not rerun verification.",
    criteria: {
      audit: "Bounded diff/relevant-file evidence audit is sufficient.",
      deep: "Broader semantic inspection is warranted because scope, contracts, or interactions are cross-cutting/critical.",
    },
  },
} as const

export interface ReviewRoutingResult {
  minimumMode: ReviewMode
  mode: ReviewMode
  source: "deterministic" | "jev" | "fallback"
  jevCalled: boolean
  jevAvailable: boolean
  reason?: string
  model?: string
  latencyMs?: number
  answers?: RawAnswers
}

function env(name: string): string | undefined {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name]
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

function reviewModel(): string { return env("ANDMAR_REVIEW_MODEL") ?? DEFAULT_JEV_MODEL }
function reviewTimeout(): number {
  const raw = env("ANDMAR_REVIEW_TIMEOUT_MS")
  const parsed = raw === undefined ? DEFAULT_REVIEW_JEV_TIMEOUT_MS : Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_REVIEW_JEV_TIMEOUT_MS
  return Math.min(Math.max(Math.round(parsed), 1_000), 15_000)
}

function sanitizeSummary(value: string): string {
  return value
    .replace(/\b[a-f0-9]{32,64}\b/gi, "[opaque-id-omitted]")
    .replace(/\b(?:receipt|execution|verification)[/:][^\s,;]+/gi, "[internal-ref-omitted]")
    .slice(0, 2_000)
}

function errorReason(error: unknown): string {
  const code = (error as { code?: unknown })?.code
  return typeof code === "string" ? code : "request_failed"
}

export async function routeReviewWithJev(
  input: { contract: TaskContract; minimumMode: ReviewMode; changedPaths: string[]; verificationSummary?: string | undefined },
  options: { fetchFn?: FetchFn } = {},
): Promise<ReviewRoutingResult> {
  const { contract, minimumMode, changedPaths } = input
  if (minimumMode !== "audit" || !JEV_REVIEW_KINDS.has(contract.taskKind)) {
    return { minimumMode, mode: minimumMode, source: "deterministic", jevCalled: false, jevAvailable: true }
  }

  const verificationSummary = input.verificationSummary?.trim()
  if (!verificationSummary) {
    return { minimumMode, mode: minimumMode, source: "fallback", jevCalled: false, jevAvailable: true, reason: "missing_verification_summary" }
  }

  const apiKey = readApiKey()
  if (!apiKey) {
    return { minimumMode, mode: minimumMode, source: "fallback", jevCalled: false, jevAvailable: false, reason: "missing_api_key" }
  }

  const state = JSON.stringify({
    taskKind: contract.taskKind,
    goal: contract.goal,
    desiredOutcome: contract.desiredOutcome ?? null,
    requirements: contract.requirements.map((req) => ({ id: req.id, status: req.status, text: req.text })),
    constraints: contract.constraints.map((con) => ({ id: con.id, text: con.text })),
    changedPaths: changedPaths.slice(0, 100),
    verificationSummary: sanitizeSummary(verificationSummary),
  })

  try {
    const result = await callJevDecision(state, {
      apiKey,
      model: reviewModel(),
      timeoutMs: reviewTimeout(),
      questions: REVIEW_QUESTIONS,
      ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
    })
    const choice = result.answers.review_depth?.choice
    if (choice !== "audit" && choice !== "deep") throw Object.assign(new Error("invalid_response"), { code: "invalid_response" })

    // Jev may escalate only. Deterministic policy is the floor.
    const mode: ReviewMode = choice === "deep" ? "deep" : minimumMode
    return {
      minimumMode,
      mode,
      source: "jev",
      jevCalled: true,
      jevAvailable: true,
      model: result.modelReturned,
      latencyMs: result.latencyMs,
      answers: result.answers,
    }
  } catch (error) {
    return {
      minimumMode,
      mode: minimumMode,
      source: "fallback",
      jevCalled: true,
      jevAvailable: false,
      reason: errorReason(error),
    }
  }
}
