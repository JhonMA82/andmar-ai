// Pure intake decision logic (no OpenCode imports, no network).
//
// Deterministic first, Jev second, generative reasoning only when necessary.
// The deterministic layer never pretends to be Jev: it only produces a cheap
// guess used for trivial bypass and for explicit fallback when Jev is
// unavailable.

import type { ChangeKind, Risk } from "../../core/contracts.ts";
import type { RawAnswers } from "./jev.ts";
import { INTAKE_QUESTION_IDS } from "./questions.ts";

export const ALLOWED_KINDS: readonly ChangeKind[] = [
  "trivial-ui",
  "docs-format",
  "known-test",
  "feature",
  "bugfix",
  "refactor",
  "debug",
  "architecture",
  "security",
  "migration",
  "review",
  "internal",
];

export type IntakeSource = "jev" | "deterministic" | "fallback";

export interface RouteSignals {
  kind: ChangeKind;
  risk: Risk;
  uncertainty: "low" | "medium" | "high";
  reasoning: "low" | "medium" | "high";
  publicApi: boolean;
  externalSideEffects: boolean;
}

export interface IntakeDecision {
  taskKind: ChangeKind;
  needsRefinement: boolean;
  specificationSufficiency: number;
  risk: number;
  riskLevel: Risk;
  externalContract: boolean;
  productDecisionMissing: boolean;
  source: IntakeSource;
  jevAvailable: boolean;
  jevCalled: boolean;
  jevModel: string;
  reason?: string;
  latencyMs?: number;
  routeSignals: RouteSignals;
  brief: {
    required: boolean;
    sections: string[];
    askUserOnlyIf: string;
  };
}

export const BRIEF_SECTIONS = [
  "Intent",
  "Relevant context",
  "Constraints",
  "Acceptance criteria",
  "Risks / external contracts",
  "Unresolved product decisions",
] as const;

const RISK_LEVELS: readonly Risk[] = ["low", "medium", "high", "critical"];

export function riskScoreToLevel(score: number): Risk {
  const clamped = Math.min(Math.max(Math.round(score), 0), 3);
  return RISK_LEVELS[clamped] ?? "low";
}

export function sufficiencyToUncertainty(sufficiency: number): "low" | "medium" | "high" {
  if (sufficiency <= 1) return "high";
  if (sufficiency === 2) return "medium";
  return "low";
}

export function kindToReasoning(kind: ChangeKind, sufficiency: number): "low" | "medium" | "high" {
  if (kind === "architecture" || kind === "security" || kind === "migration" || kind === "debug") return "high";
  if (sufficiency <= 1) return "high";
  if (sufficiency === 2) return "medium";
  return "low";
}

export interface DeterministicGuess {
  taskKind: ChangeKind;
  trivial: boolean;
  externalContractSuspected: boolean;
}

const MIGRATION_RE = /migr|opencode\s*v2|v1.*v2|port\s*(a|de|this|este)?\s*plugin|compatib|major\s*upgrade/i;
const SECURITY_RE = /falsif|forg|spoof|receipt|auth|permis|token|secret|segur|vulnerab|inject|firmas?|hmac/i;
const EXTERNAL_RE = /google|oauth|sso|github\s*login|stripe|webhook|proveedor\s*extern|external\s*(api|provider)|auth\s*provider|opencode\s*v2|plugin.*migr|migr.*plugin/i;
const TRIVIAL_RE = /cambia|change|renombra|rename|typo|traduc|texto|bot[oó]n|button|label|guardar/i;
const BUG_RE = /falla|falla\s*cuando|esto\s*falla|no\s*funciona|fails?\s*when|two\s*sessions|dos\s*sesiones|race|flaky/i;
const FEATURE_RE = /agrega|a[ñn]ade|add|implementa|crea|validaci[oó]n|formulario/i;

export function deterministicClassify(request: string): DeterministicGuess {
  const text = request.toLowerCase();
  const migration = MIGRATION_RE.test(text);
  const security = SECURITY_RE.test(text);
  const external = EXTERNAL_RE.test(text);
  if (migration) return { taskKind: "migration", trivial: false, externalContractSuspected: true };
  if (request.trim().length < 80 && TRIVIAL_RE.test(text) && !security && !migration && !external && !BUG_RE.test(text)) {
    return { taskKind: "trivial-ui", trivial: true, externalContractSuspected: false };
  }
  if (security) return { taskKind: "security", trivial: false, externalContractSuspected: external };
  if (BUG_RE.test(text)) return { taskKind: "debug", trivial: false, externalContractSuspected: external };
  if (FEATURE_RE.test(text)) return { taskKind: "feature", trivial: false, externalContractSuspected: external };
  if (text.includes("review") || text.includes("revisa")) return { taskKind: "review", trivial: false, externalContractSuspected: false };
  if (text.includes("refactor")) return { taskKind: "refactor", trivial: false, externalContractSuspected: false };
  if (text.includes("doc")) return { taskKind: "docs-format", trivial: false, externalContractSuspected: false };
  return { taskKind: "internal", trivial: false, externalContractSuspected: external };
}

export function isTrivialBypass(request: string): boolean {
  return deterministicClassify(request).trivial;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export interface ParsedJev {
  taskKind: ChangeKind;
  needsRefinement: boolean;
  needsRefinementProb: number;
  specificationSufficiency: number;
  risk: number;
  riskLevel: Risk;
  externalContract: boolean;
  externalContractProb: number;
  productDecisionMissing: boolean;
  productDecisionMissingProb: number;
}

export function parseJevAnswers(raw: RawAnswers): ParsedJev {
  for (const id of INTAKE_QUESTION_IDS) {
    if (typeof raw[id] !== "object" || raw[id] === null) throw new Error(`invalid_response:missing:${id}`);
  }
  const taskRaw = raw["task_kind"] as Record<string, unknown>;
  if (taskRaw["type"] !== "choice" || typeof taskRaw["choice"] !== "string" || !(ALLOWED_KINDS as readonly string[]).includes(taskRaw["choice"] as string)) {
    throw new Error("invalid_response:task_kind");
  }
  const needsRaw = raw["needs_refinement"] as Record<string, unknown>;
  const needsProb = asNumber(needsRaw["noul"]);
  if (needsRaw["type"] !== "noul" || needsProb === undefined || needsProb < 0 || needsProb > 1) {
    throw new Error("invalid_response:needs_refinement");
  }
  const suffRaw = raw["specification_sufficiency"] as Record<string, unknown>;
  const suffScore = asNumber(suffRaw["score"]);
  if (suffRaw["type"] !== "score" || suffScore === undefined) throw new Error("invalid_response:specification_sufficiency");
  const riskRaw = raw["risk"] as Record<string, unknown>;
  const riskScore = asNumber(riskRaw["score"]);
  if (riskRaw["type"] !== "score" || riskScore === undefined) throw new Error("invalid_response:risk");
  const extRaw = raw["external_contract"] as Record<string, unknown>;
  const extProb = asNumber(extRaw["noul"]);
  if (extRaw["type"] !== "noul" || extProb === undefined || extProb < 0 || extProb > 1) {
    throw new Error("invalid_response:external_contract");
  }
  const prodRaw = raw["product_decision_missing"] as Record<string, unknown>;
  const prodProb = asNumber(prodRaw["noul"]);
  if (prodRaw["type"] !== "noul" || prodProb === undefined || prodProb < 0 || prodProb > 1) {
    throw new Error("invalid_response:product_decision_missing");
  }

  const sufficiency = Math.min(Math.max(Math.round(suffScore), 0), 4);
  const risk = Math.min(Math.max(Math.round(riskScore), 0), 3);
  const taskKind = taskRaw["choice"] as ChangeKind;
  return {
    taskKind,
    needsRefinement: needsProb >= 0.5,
    needsRefinementProb: needsProb,
    specificationSufficiency: sufficiency,
    risk,
    riskLevel: riskScoreToLevel(risk),
    externalContract: extProb >= 0.5,
    externalContractProb: extProb,
    productDecisionMissing: prodProb >= 0.5,
    productDecisionMissingProb: prodProb,
  };
}

function buildRouteSignals(input: { kind: ChangeKind; riskLevel: Risk; sufficiency: number; externalContract: boolean }): RouteSignals {
  return {
    kind: input.kind,
    risk: input.riskLevel,
    uncertainty: sufficiencyToUncertainty(input.sufficiency),
    reasoning: kindToReasoning(input.kind, input.sufficiency),
    publicApi: false,
    externalSideEffects: input.externalContract,
  };
}

function briefFor(needsRefinement: boolean): IntakeDecision["brief"] {
  return {
    required: needsRefinement,
    sections: [...BRIEF_SECTIONS],
    askUserOnlyIf: "a real product decision is missing that cannot be resolved responsibly from repo, config, code, tests, docs, upstream, or AndMar capabilities",
  };
}

export function decisionFromJev(parsed: ParsedJev, meta: { jevModel: string; latencyMs: number }): IntakeDecision {
  return {
    taskKind: parsed.taskKind,
    needsRefinement: parsed.needsRefinement,
    specificationSufficiency: parsed.specificationSufficiency,
    risk: parsed.risk,
    riskLevel: parsed.riskLevel,
    externalContract: parsed.externalContract,
    productDecisionMissing: parsed.productDecisionMissing,
    source: "jev",
    jevAvailable: true,
    jevCalled: true,
    jevModel: meta.jevModel,
    latencyMs: meta.latencyMs,
    routeSignals: buildRouteSignals({
      kind: parsed.taskKind,
      riskLevel: parsed.riskLevel,
      sufficiency: parsed.specificationSufficiency,
      externalContract: parsed.externalContract,
    }),
    brief: briefFor(parsed.needsRefinement),
  };
}

export function decisionDeterministic(request: string, jevModel: string): IntakeDecision {
  const guess = deterministicClassify(request);
  const sufficiency = guess.trivial ? 4 : 2;
  const riskLevel: Risk = guess.taskKind === "migration" || guess.taskKind === "security" ? "high" : "low";
  const risk = RISK_LEVELS.indexOf(riskLevel);
  return {
    taskKind: guess.taskKind,
    needsRefinement: false,
    specificationSufficiency: sufficiency,
    risk,
    riskLevel,
    externalContract: guess.externalContractSuspected,
    productDecisionMissing: false,
    source: "deterministic",
    jevAvailable: true,
    jevCalled: false,
    jevModel,
    reason: "trivial_bypass",
    routeSignals: buildRouteSignals({ kind: guess.taskKind, riskLevel, sufficiency, externalContract: guess.externalContractSuspected }),
    brief: briefFor(false),
  };
}

export function decisionFallback(input: {
  request: string;
  jevModel: string;
  reason: string;
  jevCalled: boolean;
  latencyMs?: number;
}): IntakeDecision {
  const guess = deterministicClassify(input.request);
  const sufficiency = guess.trivial ? 4 : 2;
  const riskLevel: Risk = guess.taskKind === "migration" || guess.taskKind === "security" ? "high" : "low";
  const risk = RISK_LEVELS.indexOf(riskLevel);
  // Fallback never blocks AndMar: report the deterministic guess explicitly as
  // fallback, never as a Jev classification.
  return {
    taskKind: guess.taskKind,
    needsRefinement: false,
    specificationSufficiency: sufficiency,
    risk,
    riskLevel,
    externalContract: guess.externalContractSuspected,
    productDecisionMissing: false,
    source: "fallback",
    jevAvailable: false,
    jevCalled: input.jevCalled,
    jevModel: input.jevModel,
    reason: input.reason,
    ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
    routeSignals: buildRouteSignals({ kind: guess.taskKind, riskLevel, sufficiency, externalContract: guess.externalContractSuspected }),
    brief: briefFor(false),
  };
}
