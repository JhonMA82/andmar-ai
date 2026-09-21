// Structured development trace for intake (no free-text logs, no secrets).
//
// Disabled by default. Enabled with ANDMAR_INTAKE_TRACE=1.
// Full request content only with ANDMAR_INTAKE_TRACE_CONTENT=1.
// Reuses the existing AndMar StateStore; keeps at most MAX_TRACE_ENTRIES.

import { createHash, randomUUID } from "node:crypto";
import type { StateStore } from "../../core/contracts.ts";
import type { RawAnswers } from "./jev.ts";

export const TRACE_PREFIX = "intake-trace/";
export const MAX_TRACE_ENTRIES = 20;
export const MAX_TRACE_QUERY_LIMIT = 20;

export interface TraceAnswers {
  [questionId: string]: {
    type?: string;
    choice?: string;
    noul?: number;
    score?: number;
    confidence?: number;
    probabilities?: Record<string, number>;
    legend?: Record<string, unknown>;
  };
}

export interface IntakeTraceEntry {
  timestamp: string;
  sessionID: string;
  requestHash: string;
  requestLength: number;
  jevModel: string;
  jevCalled: boolean;
  jevAvailable: boolean;
  source: string;
  reason?: string;
  latencyMs: number;
  answers: TraceAnswers;
  decision: {
    refine: boolean;
    taskKind?: string;
    needsRefinement?: boolean;
    externalContract?: boolean;
    productDecisionMissing?: boolean;
  };
  request?: string;
}

export function isTraceEnabled(): boolean {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.["ANDMAR_INTAKE_TRACE"] === "1";
}

export function includeTraceContent(): boolean {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.["ANDMAR_INTAKE_TRACE_CONTENT"] === "1";
}

export function hashRequest(request: string): string {
  return createHash("sha256").update(request, "utf8").digest("hex");
}

function sanitizeAnswers(raw: RawAnswers): TraceAnswers {
  const out: TraceAnswers = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    const clean: TraceAnswers[string] = {};
    if (typeof entry["type"] === "string") clean.type = entry["type"] as string;
    if (typeof entry["choice"] === "string") clean.choice = entry["choice"] as string;
    if (typeof entry["noul"] === "number") clean.noul = entry["noul"] as number;
    if (typeof entry["score"] === "number") clean.score = entry["score"] as number;
    if (typeof entry["confidence"] === "number") clean.confidence = entry["confidence"] as number;
    if (typeof entry["probabilities"] === "object" && entry["probabilities"] !== null) {
      const probs: Record<string, number> = {};
      for (const [k, v] of Object.entries(entry["probabilities"] as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v)) probs[k] = v;
      }
      clean.probabilities = probs;
    }
    if (typeof entry["legend"] === "object" && entry["legend"] !== null) {
      clean.legend = entry["legend"] as Record<string, unknown>;
    }
    out[key] = clean;
  }
  return out;
}

export function buildTraceEntry(input: {
  sessionID: string;
  request: string;
  jevModel: string;
  jevCalled: boolean;
  jevAvailable: boolean;
  source: string;
  reason?: string | undefined;
  latencyMs: number;
  rawAnswers: RawAnswers;
  refine: boolean;
  taskKind?: string | undefined;
  needsRefinement?: boolean | undefined;
  externalContract?: boolean | undefined;
  productDecisionMissing?: boolean | undefined;
  at?: number | undefined;
}): IntakeTraceEntry {
  const entry: IntakeTraceEntry = {
    timestamp: new Date(input.at ?? Date.now()).toISOString(),
    sessionID: input.sessionID,
    requestHash: hashRequest(input.request),
    requestLength: input.request.length,
    jevModel: input.jevModel,
    jevCalled: input.jevCalled,
    jevAvailable: input.jevAvailable,
    source: input.source,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    latencyMs: input.latencyMs,
    answers: sanitizeAnswers(input.rawAnswers),
    decision: {
      refine: input.refine,
      ...(input.taskKind === undefined ? {} : { taskKind: input.taskKind }),
      ...(input.needsRefinement === undefined ? {} : { needsRefinement: input.needsRefinement }),
      ...(input.externalContract === undefined ? {} : { externalContract: input.externalContract }),
      ...(input.productDecisionMissing === undefined ? {} : { productDecisionMissing: input.productDecisionMissing }),
    },
  };
  if (includeTraceContent()) entry.request = input.request;
  return entry;
}

export function traceKey(entry: IntakeTraceEntry): string {
  const rand = typeof randomUUID === "function" ? randomUUID().slice(0, 8) : `${Math.floor(Math.random() * 1e8)}`;
  return `${TRACE_PREFIX}${entry.timestamp.replace(/[:.]/g, "-")}-${rand}`;
}

export async function saveTrace(state: StateStore, entry: IntakeTraceEntry): Promise<boolean> {
  if (!isTraceEnabled()) return false;
  await state.set(traceKey(entry), entry);
  const existing = await state.scan<IntakeTraceEntry>(TRACE_PREFIX);
  if (existing.length > MAX_TRACE_ENTRIES) {
    const sorted = [...existing].sort((a, b) => (a.value.timestamp < b.value.timestamp ? 1 : -1));
    for (const extra of sorted.slice(MAX_TRACE_ENTRIES)) await state.remove(extra.key);
  }
  return true;
}

export async function listTraces(state: StateStore, limit = 10): Promise<IntakeTraceEntry[]> {
  const clamped = Math.min(Math.max(Math.round(limit) || 10, 1), MAX_TRACE_QUERY_LIMIT);
  const entries = await state.scan<IntakeTraceEntry>(TRACE_PREFIX);
  return entries
    .map((e) => e.value)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .slice(0, clamped);
}

export function traceContainsSecret(traceJson: string, secrets: Array<string | undefined>): boolean {
  for (const secret of secrets) {
    if (typeof secret === "string" && secret !== "" && traceJson.includes(secret)) return true;
  }
  return false;
}
