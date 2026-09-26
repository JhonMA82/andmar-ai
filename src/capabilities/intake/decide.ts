// Pure intake decision logic (no OpenCode imports, no network).
//
// Deterministic first, Jev second, generative reasoning only when necessary.
// The deterministic layer never pretends to be Jev: it only produces a cheap
// guess used for trivial bypass and for explicit fallback when Jev is
// unavailable.

import type { ChangeKind, Risk } from "../../core/contracts.ts";
import { MAX_STATE_CHARS, type RawAnswers } from "./jev.ts";
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

export type IntakeMode = "direct" | "enrich" | "structure";

export type WorkProjectionMode = "none" | "lightweight" | "structured";

export interface WorkProjection {
  mode: WorkProjectionMode;
  preserveSource: boolean;
}

export type RequestShape = "compact" | "underspecified" | "structured";
export const ALLOWED_SHAPES: readonly RequestShape[] = ["compact", "underspecified", "structured"];

export function workProjectionFor(mode: IntakeMode): WorkProjection {
  switch (mode) {
    case "direct":
      return { mode: "none", preserveSource: false };
    case "enrich":
      return { mode: "lightweight", preserveSource: true };
    case "structure":
      return { mode: "structured", preserveSource: true };
  }
}

export interface DeriveIntakeModeInput {
  requestLength: number;
  maxStateChars?: number;
  trivial?: boolean;
  needsRefinement?: boolean;
  specificationSufficiency?: number;
  requestShape?: RequestShape;
  continuationFastPath?: boolean;
}

export function deriveIntakeMode(input: DeriveIntakeModeInput): IntakeMode {
  // Priority 1 — continuation fast path
  if (input.continuationFastPath) {
    return "direct";
  }

  const limit = input.maxStateChars ?? MAX_STATE_CHARS;

  // Priority 2 — partial decision context
  // Requests exceeding the decision window must deterministically be "structure".
  // Jev can never downgrade this.
  if (input.requestLength > limit) {
    return "structure";
  }

  // Priority 3 — trivial deterministic bypass
  if (input.trivial) {
    return "direct";
  }

  // Priority 4 — explicit structured shape
  // Allows detailed specs under MAX_STATE_CHARS to be structured without losing obligations.
  if (input.requestShape === "structured") {
    return "structure";
  }

  // Priority 5 — insufficient specification
  // Any of: underspecified shape, needsRefinement=true, or sufficiency <= 2
  if (
    input.requestShape === "underspecified" ||
    input.needsRefinement === true ||
    (input.specificationSufficiency !== undefined && input.specificationSufficiency <= 2)
  ) {
    return "enrich";
  }

  // Priority 6 — direct
  // Only when coherent sufficiency evidence exists (needsRefinement=false && sufficiency >= 3)
  if (
    input.needsRefinement === false &&
    input.specificationSufficiency !== undefined &&
    input.specificationSufficiency >= 3
  ) {
    return "direct";
  }

  // If needsRefinement is explicitly false without sufficiency score (e.g. legacy/direct tests)
  if (input.needsRefinement === false && input.specificationSufficiency === undefined) {
    return "direct";
  }

  // Default conservative fallback
  return "enrich";
}

export interface RouteSignals {
  kind: ChangeKind;
  risk: Risk;
  uncertainty: "low" | "medium" | "high";
  reasoning: "low" | "medium" | "high";
  publicApi: boolean;
  externalSideEffects: boolean;
}

export interface IntakeDecision {
  mode: IntakeMode;
  workProjection: WorkProjection;
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
  continuation?: ContinuationDecision;
}

export type ContinuationRelation =
  | "operational_continuation"
  | "task_extension"
  | "new_task";

export type ContinuationMutation =
  | "operational_only"
  | "metadata_only"
  | "metadata_and_operational"
  | "code_or_behavior";

export interface ContinuationDecision {
  previousTaskCompleted: true;
  relation: ContinuationRelation;
  mutation: ContinuationMutation;
  newRequirement: boolean;
  newRequirementProb: number;
  fastPath: boolean;
  source: "deterministic" | "jev";
  confidence?: number;
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

const CONTINUATION_DENY_RE =
  /corrige|correg|arregl|\bfix\b|bug|cambi|necesari|refactor|debug|login|test|implement|añad|agrega|modifica|mejora|funcion|error|fallo|falla|pero|antes|tambi[eé]n|primero/i;
const CONTINUATION_VERSION_RE = /versiona|versi[oó]n|\bversion\b|bump|changelog/i;
const CONTINUATION_OPS_RE = /\bpush\b|\bcommit\b|\btag\b|\bsube\b|publica|publish/i;

function continuationMutationFor(text: string): ContinuationMutation {
  const hasVersion = CONTINUATION_VERSION_RE.test(text);
  const hasOps = CONTINUATION_OPS_RE.test(text);
  if (hasVersion && hasOps) return "metadata_and_operational";
  if (hasVersion) return "metadata_only";
  return "operational_only";
}

const CONTINUATION_ALLOW_RES: RegExp[] = [
  /^\s*(sube\s+y\s+versiona|versiona\s+y\s+sube)\s*[.!]*\s*$/i,
  /^\s*(haz\s+)?commit(\s+y\s+push)?\s*[.!]*\s*$/i,
  /^\s*(haz\s+)?push\s*[.!]*\s*$/i,
  /actualiza\s+la\s+versi[oó]n/i,
  /crea\s+el\s+tag/i,
  /\bcommit\s+y\s+push\b/i,
];

export function deterministicContinuation(request: string): ContinuationDecision | undefined {
  const trimmed = request.trim();
  if (trimmed === "") return undefined;
  const words = trimmed.split(/\s+/).length;
  if (trimmed.length > 60 || words > 8) return undefined;
  const lower = trimmed.toLowerCase();
  if (CONTINUATION_DENY_RE.test(lower)) return undefined;
  const allowed = CONTINUATION_ALLOW_RES.some((re) => re.test(trimmed));
  if (!allowed) {
    // Narrow generic fallback: short request with only version/ops vocabulary.
    const tokens = lower.replace(/[.!]+$/g, "").split(/[\s_]+/);
    const vocab = new Set(["sube", "y", "versiona", "version", "versión", "versionar", "actualiza", "la", "el", "haz", "hacer", "crea", "crear", "commit", "push", "tag", "bump", "changelog", "publica", "publish", "por", "favor"]);
    const allKnown = tokens.every((t) => vocab.has(t));
    if (!allKnown) return undefined;
    if (!CONTINUATION_VERSION_RE.test(lower) && !CONTINUATION_OPS_RE.test(lower)) return undefined;
  }
  return {
    previousTaskCompleted: true,
    relation: "operational_continuation",
    mutation: continuationMutationFor(lower),
    newRequirement: false,
    newRequirementProb: 0,
    fastPath: true,
    source: "deterministic",
    confidence: 1,
  };
}

const ALLOWED_RELATIONS: readonly string[] = [
  "operational_continuation",
  "task_extension",
  "new_task",
];
const ALLOWED_MUTATIONS: readonly string[] = [
  "operational_only",
  "metadata_only",
  "metadata_and_operational",
  "code_or_behavior",
];

function choiceConfidence(entry: Record<string, unknown>, choice: string): number | undefined {
  const conf = entry["confidence"];
  if (typeof conf === "number" && Number.isFinite(conf)) return conf;
  const probs = entry["probabilities"];
  if (typeof probs === "object" && probs !== null && !Array.isArray(probs)) {
    const v = (probs as Record<string, unknown>)[choice];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

export function parseContinuationAnswers(raw: RawAnswers): ContinuationDecision {
  for (const id of ["continuation_relation", "continuation_mutation", "continuation_new_requirement"]) {
    if (typeof raw[id] !== "object" || raw[id] === null) throw new Error(`invalid_response:missing:${id}`);
  }
  const relRaw = raw["continuation_relation"] as Record<string, unknown>;
  if (relRaw["type"] !== "choice" || typeof relRaw["choice"] !== "string" || !ALLOWED_RELATIONS.includes(relRaw["choice"] as string)) {
    throw new Error("invalid_response:continuation_relation");
  }
  const mutRaw = raw["continuation_mutation"] as Record<string, unknown>;
  if (mutRaw["type"] !== "choice" || typeof mutRaw["choice"] !== "string" || !ALLOWED_MUTATIONS.includes(mutRaw["choice"] as string)) {
    throw new Error("invalid_response:continuation_mutation");
  }
  const reqRaw = raw["continuation_new_requirement"] as Record<string, unknown>;
  const reqProb = asNumber(reqRaw["noul"]);
  if (reqRaw["type"] !== "noul" || reqProb === undefined || reqProb < 0 || reqProb > 1) {
    throw new Error("invalid_response:continuation_new_requirement");
  }
  const relation = relRaw["choice"] as ContinuationRelation;
  const mutation = mutRaw["choice"] as ContinuationMutation;
  const confidences: number[] = [];
  const relConf = choiceConfidence(relRaw, relation);
  if (relConf !== undefined) confidences.push(relConf);
  const mutConf = choiceConfidence(mutRaw, mutation);
  if (mutConf !== undefined) confidences.push(mutConf);
  const minConfidence = confidences.length > 0 ? Math.min(...confidences) : undefined;
  const fastPath =
    relation === "operational_continuation" &&
    mutation !== "code_or_behavior" &&
    reqProb < 0.25 &&
    (minConfidence === undefined || minConfidence >= 0.7);
  return {
    previousTaskCompleted: true,
    relation,
    mutation,
    newRequirement: reqProb >= 0.5,
    newRequirementProb: reqProb,
    fastPath,
    source: "jev",
    ...(minConfidence === undefined ? {} : { confidence: minConfidence }),
  };
}

export function withContinuationDecision(
  decision: IntakeDecision,
  continuation: ContinuationDecision,
): IntakeDecision {
  if (!continuation.fastPath) return { ...decision, continuation };
  const externalSideEffects =
    continuation.mutation === "operational_only" ||
    continuation.mutation === "metadata_and_operational";
  const mode: IntakeMode = "direct";
  const workProjection = workProjectionFor(mode);
  return {
    ...decision,
    mode,
    workProjection,
    taskKind: "internal",
    needsRefinement: false,
    specificationSufficiency: 4,
    routeSignals: {
      ...decision.routeSignals,
      kind: "internal",
      uncertainty: "low",
      reasoning: "low",
      externalSideEffects,
    },
    brief: { ...decision.brief, required: false },
    continuation,
  };
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
  requestShape: RequestShape;
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
  const shapeRaw = raw["request_shape"] as Record<string, unknown>;
  if (shapeRaw["type"] !== "choice" || typeof shapeRaw["choice"] !== "string" || !(ALLOWED_SHAPES as readonly string[]).includes(shapeRaw["choice"] as string)) {
    throw new Error("invalid_response:request_shape");
  }

  const sufficiency = Math.min(Math.max(Math.round(suffScore), 0), 4);
  const risk = Math.min(Math.max(Math.round(riskScore), 0), 3);
  const taskKind = taskRaw["choice"] as ChangeKind;
  const requestShape = shapeRaw["choice"] as RequestShape;
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
    requestShape,
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

export function decisionFromJev(
  parsed: ParsedJev,
  meta: { jevModel: string; latencyMs: number; requestLength?: number },
): IntakeDecision {
  const mode = deriveIntakeMode({
    requestLength: meta.requestLength ?? 0,
    maxStateChars: MAX_STATE_CHARS,
    trivial: false,
    needsRefinement: parsed.needsRefinement,
    specificationSufficiency: parsed.specificationSufficiency,
    requestShape: parsed.requestShape,
  });
  const workProjection = workProjectionFor(mode);
  const needsRefinement = mode !== "direct";
  return {
    mode,
    workProjection,
    taskKind: parsed.taskKind,
    needsRefinement,
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
    brief: briefFor(needsRefinement),
  };
}

export function requireFullRequestReview(
  decision: IntakeDecision,
  requestLength: number,
  decisionContextLimit: number,
): IntakeDecision {
  if (requestLength <= decisionContextLimit) return decision;

  const continuation = decision.continuation
    ? { ...decision.continuation, fastPath: false }
    : undefined;

  const mode: IntakeMode = "structure";
  const workProjection = workProjectionFor(mode);

  return {
    ...decision,
    mode,
    workProjection,
    needsRefinement: true,
    specificationSufficiency: Math.min(decision.specificationSufficiency, 2),
    reason: decision.reason ?? "decision_context_truncated",
    routeSignals: {
      ...decision.routeSignals,
      uncertainty: decision.routeSignals.uncertainty === "high" ? "high" : "medium",
      reasoning: decision.routeSignals.reasoning === "high" ? "high" : "medium",
    },
    brief: { ...decision.brief, required: true },
    ...(continuation === undefined ? {} : { continuation }),
  };
}

export function decisionRawRequestUnavailable(jevModel: string): IntakeDecision {
  const base = decisionFallback({
    request: "",
    jevModel,
    reason: "raw_request_unavailable",
    jevCalled: false,
  });

  const mode: IntakeMode = "enrich";
  const workProjection = workProjectionFor(mode);

  return {
    ...base,
    mode,
    workProjection,
    needsRefinement: true,
    specificationSufficiency: 0,
    reason: "raw_request_unavailable",
    routeSignals: {
      ...base.routeSignals,
      uncertainty: "high",
      reasoning: "high",
    },
    brief: { ...base.brief, required: true },
  };
}

export function decisionDeterministic(request: string, jevModel: string): IntakeDecision {
  const guess = deterministicClassify(request);
  const sufficiency = guess.trivial ? 4 : 2;
  const riskLevel: Risk = guess.taskKind === "migration" || guess.taskKind === "security" ? "high" : "low";
  const risk = RISK_LEVELS.indexOf(riskLevel);
  const mode = deriveIntakeMode({
    requestLength: request.length,
    maxStateChars: MAX_STATE_CHARS,
    trivial: guess.trivial,
    needsRefinement: false,
    specificationSufficiency: sufficiency,
    ...(guess.trivial ? { requestShape: "compact" as const } : {}),
  });
  const workProjection = workProjectionFor(mode);
  const needsRefinement = mode !== "direct";
  return {
    mode,
    workProjection,
    taskKind: guess.taskKind,
    needsRefinement,
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
    brief: briefFor(needsRefinement),
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
  const isLong = input.request.length > MAX_STATE_CHARS;
  const isTrivial = guess.trivial;
  const sufficiency = isTrivial ? 4 : 2;
  const riskLevel: Risk = guess.taskKind === "migration" || guess.taskKind === "security" ? "high" : "low";
  const risk = RISK_LEVELS.indexOf(riskLevel);

  let mode: IntakeMode;
  if (isLong) {
    mode = "structure";
  } else if (isTrivial) {
    mode = "direct";
  } else {
    mode = "enrich";
  }

  const workProjection = workProjectionFor(mode);
  const needsRefinement = mode !== "direct";

  return {
    mode,
    workProjection,
    taskKind: guess.taskKind,
    needsRefinement,
    specificationSufficiency: isLong ? Math.min(sufficiency, 2) : sufficiency,
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
    routeSignals: buildRouteSignals({
      kind: guess.taskKind,
      riskLevel,
      sufficiency: isLong ? Math.min(sufficiency, 2) : sufficiency,
      externalContract: guess.externalContractSuspected,
    }),
    brief: briefFor(needsRefinement),
  };
}
