import test from "node:test";
import assert from "node:assert/strict";
import type { StateStore } from "../src/core/contracts.ts";
import { CONTINUATION_QUESTIONS, INTAKE_QUESTIONS, INTAKE_QUESTION_IDS } from "../src/capabilities/intake/questions.ts";
import { callJev, DEFAULT_JEV_MODEL, MAX_STATE_CHARS, readApiKey, resolveJevModel, truncateState } from "../src/capabilities/intake/jev.ts";
import {
  decisionDeterministic,
  decisionFallback,
  decisionFromJev,
  deriveIntakeMode,
  deterministicClassify,
  deterministicContinuation,
  isTrivialBypass,
  parseContinuationAnswers,
  parseJevAnswers,
  requireFullRequestReview,
  withContinuationDecision,
  workProjectionFor,
  type IntakeMode,
  type WorkProjectionMode,
} from "../src/capabilities/intake/decide.ts";
import {
  buildTraceEntry,
  hashRequest,
  includeTraceContent,
  isTraceEnabled,
  listTraces,
  saveTrace,
  traceContainsSecret,
  MAX_TRACE_ENTRIES,
} from "../src/capabilities/intake/trace.ts";
import { extractRawUserRequest, runIntake, toolMessageIDFrom } from "../src/capabilities/intake/index.ts";

function memoryState(): StateStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) { return map.get(key) as T | undefined; },
    async set<T>(key: string, value: T) { map.set(key, value); },
    async remove(key: string) { map.delete(key); },
    async scan<T>(prefix: string) {
      return [...map.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value: value as T }));
    },
  };
}

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void> | void): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return (async () => {
    try { await fn(); } finally { restore(); }
  })();
}

function jevAnswers(overrides: Record<string, Record<string, unknown>> = {}): Record<string, Record<string, unknown>> {
  const base: Record<string, Record<string, unknown>> = {
    task_kind: { type: "choice", choice: "feature", confidence: 0.8, probabilities: { feature: 0.8 } },
    needs_refinement: { type: "noul", noul: 0.2 },
    specification_sufficiency: { type: "score", score: 3, confidence: 0.7 },
    risk: { type: "score", score: 1, confidence: 0.7 },
    external_contract: { type: "noul", noul: 0.1 },
    product_decision_missing: { type: "noul", noul: 0.1 },
    request_shape: { type: "choice", choice: "compact", confidence: 0.8, probabilities: { compact: 0.8 } },
  };
  return { ...base, ...overrides };
}

function mockFetchSuccess(answers: Record<string, Record<string, unknown>>, model = "typesafe/jev-1.13-20260917") {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ model, answers, usage: { input_tokens: 100, output_tokens: 10 } }),
    text: async () => "ok",
  });
}

// --- questions ---

test("intake defines exactly seven structured questions with no free text", () => {
  assert.deepEqual([...INTAKE_QUESTION_IDS], ["task_kind", "needs_refinement", "specification_sufficiency", "risk", "external_contract", "product_decision_missing", "request_shape"]);
  assert.equal(INTAKE_QUESTIONS.task_kind.type, "choice");
  assert.equal(INTAKE_QUESTIONS.needs_refinement.type, "noul");
  assert.equal(INTAKE_QUESTIONS.specification_sufficiency.type, "score");
  assert.equal(INTAKE_QUESTIONS.risk.type, "score");
  assert.equal(INTAKE_QUESTIONS.external_contract.type, "noul");
  assert.equal(INTAKE_QUESTIONS.product_decision_missing.type, "noul");
  assert.equal(INTAKE_QUESTIONS.request_shape.type, "choice");
  assert.ok(Object.keys(INTAKE_QUESTIONS.task_kind.criteria).includes("migration"));
  assert.ok(Object.keys(INTAKE_QUESTIONS.request_shape.criteria).includes("structured"));
});

// --- deterministic ---

test("trivial request does not require refinement (deterministic bypass)", () => {
  assert.equal(isTrivialBypass("Cambia Save por Guardar"), true);
  const guess = deterministicClassify("Cambia Save por Guardar");
  assert.equal(guess.taskKind, "trivial-ui");
  const decision = decisionDeterministic("Cambia Save por Guardar", DEFAULT_JEV_MODEL);
  assert.equal(decision.needsRefinement, false);
  assert.equal(decision.source, "deterministic");
  assert.equal(decision.jevCalled, false);
  assert.equal(decision.routeSignals.kind, "trivial-ui");
  assert.equal(decision.mode, "direct");
  assert.equal(decision.workProjection.mode, "none");
  assert.equal(decision.workProjection.preserveSource, false);
});

test("vague request is not trivial and needs Jev", () => {
  assert.equal(isTrivialBypass("Haz que no se puedan falsificar los receipts"), false);
  assert.equal(isTrivialBypass("Esto falla cuando hay dos sesiones"), false);
  const parsed = parseJevAnswers(jevAnswers({
    task_kind: { type: "choice", choice: "security" },
    needs_refinement: { type: "noul", noul: 0.91 },
    specification_sufficiency: { type: "score", score: 1 },
    risk: { type: "score", score: 2 },
  }));
  const decision = decisionFromJev(parsed, { jevModel: DEFAULT_JEV_MODEL, latencyMs: 84, requestLength: 50 });
  assert.equal(decision.needsRefinement, true);
  assert.equal(decision.specificationSufficiency, 1);
  assert.equal(decision.mode, "enrich");
  assert.equal(decision.workProjection.mode, "lightweight");
  assert.equal(decision.workProjection.preserveSource, true);
  assert.equal(decision.brief.required, true);
  assert.deepEqual(decision.brief.sections, ["Intent", "Relevant context", "Constraints", "Acceptance criteria", "Risks / external contracts", "Unresolved product decisions"]);
});

test("migration detects external contract", () => {
  const parsed = parseJevAnswers(jevAnswers({
    task_kind: { type: "choice", choice: "migration" },
    needs_refinement: { type: "noul", noul: 0.9 },
    specification_sufficiency: { type: "score", score: 1 },
    risk: { type: "score", score: 3 },
    external_contract: { type: "noul", noul: 0.95 },
  }));
  const decision = decisionFromJev(parsed, { jevModel: DEFAULT_JEV_MODEL, latencyMs: 10 });
  assert.equal(decision.taskKind, "migration");
  assert.equal(decision.externalContract, true);
  assert.equal(decision.routeSignals.externalSideEffects, true);
  assert.equal(deterministicClassify("Migra este plugin a OpenCode v2").taskKind, "migration");
});

test("missing product decision is detected", () => {
  const parsed = parseJevAnswers(jevAnswers({ product_decision_missing: { type: "noul", noul: 0.88 } }));
  assert.equal(parsed.productDecisionMissing, true);
});

// --- Jev parsing ---

test("valid Jev response parses", () => {
  const parsed = parseJevAnswers(jevAnswers());
  assert.equal(parsed.taskKind, "feature");
  assert.equal(parsed.needsRefinement, false);
  assert.equal(parsed.specificationSufficiency, 3);
  assert.equal(parsed.riskLevel, "medium");
});

test("invalid Jev response throws invalid_response", () => {
  assert.throws(() => parseJevAnswers({}), /invalid_response/);
  assert.throws(() => parseJevAnswers(jevAnswers({ task_kind: { type: "choice", choice: "not-a-kind" } })), /task_kind/);
  assert.throws(() => parseJevAnswers(jevAnswers({ needs_refinement: { type: "noul" } })), /needs_refinement/);
  assert.throws(() => parseJevAnswers(jevAnswers({ risk: { type: "score" } })), /risk/);
});

test("partial decision context forces full-request review", () => {
  const parsed = parseJevAnswers(jevAnswers({
    needs_refinement: { type: "noul", noul: 0.01 },
    specification_sufficiency: { type: "score", score: 4 },
  }));
  const decision = decisionFromJev(parsed, { jevModel: DEFAULT_JEV_MODEL, latencyMs: 5 });
  const guarded = requireFullRequestReview(decision, MAX_STATE_CHARS + 1, MAX_STATE_CHARS);
  assert.equal(guarded.needsRefinement, true);
  assert.equal(guarded.mode, "structure");
  assert.equal(guarded.workProjection.mode, "structured");
  assert.equal(guarded.workProjection.preserveSource, true);
  assert.equal(guarded.brief.required, true);
  assert.ok(guarded.specificationSufficiency <= 2);
  assert.equal(guarded.reason, "decision_context_truncated");
  assert.notEqual(guarded.routeSignals.uncertainty, "low");
});

// --- Jev client ---

test("missing api key fails explicitly", async () => {
  await assert.rejects(() => callJev("hello", { apiKey: "   ", model: DEFAULT_JEV_MODEL }), /missing_api_key/);
});

test("timeout and request failure map to explicit reasons", async () => {
  const aborting = async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  };
  await assert.rejects(() => callJev("hello", { apiKey: "k", fetchFn: aborting as never }), /timeout/);
  const failing = async () => { throw new Error("boom"); };
  await assert.rejects(() => callJev("hello", { apiKey: "k", fetchFn: failing as never }), /request_failed/);
  const badStatus = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "provider down" });
  await assert.rejects(() => callJev("hello", { apiKey: "k", fetchFn: badStatus as never }), /request_failed/);
  const badPayload = async () => ({ ok: true, status: 200, json: async () => ({ nope: true }), text: async () => "{}" });
  await assert.rejects(() => callJev("hello", { apiKey: "k", fetchFn: badPayload as never }), /invalid_response/);
});

test("state is truncated deterministically", () => {
  const long = "x".repeat(9_000);
  const truncated = truncateState(long);
  assert.ok(truncated.length < long.length);
  assert.match(truncated, /truncated by AndMar AI/);
});

test("model resolution prefers config, then env, then default", async () => {
  await withEnv({ ANDMAR_INTAKE_MODEL: "typesafe/jev-1.13" }, () => {
    assert.equal(resolveJevModel(undefined), "typesafe/jev-1.13");
    assert.equal(resolveJevModel("custom/model"), "custom/model");
  });
  await withEnv({ ANDMAR_INTAKE_MODEL: undefined }, () => {
    assert.equal(resolveJevModel(undefined), DEFAULT_JEV_MODEL);
  });
});

test("extractRawUserRequest preserves the complete current user message", () => {
  const raw = `FIX 1\n${"requirement\n".repeat(1200)}DONE`;
  const messages = [
    { id: "u1", type: "user", text: raw, time: { created: 1 } },
    { id: "a1", type: "assistant", content: [], time: { created: 2 } },
  ];
  assert.equal(extractRawUserRequest(messages, "a1"), raw);
});

test("extractRawUserRequest selects the user message before the current assistant turn", () => {
  const messages = [
    { id: "u-old", type: "user", text: "old", time: { created: 1 } },
    { id: "a-old", type: "assistant", content: [{ type: "text", text: "old answer" }], time: { created: 2 } },
    { id: "u-current", type: "user", text: "RAW CURRENT REQUEST", time: { created: 3 } },
    { id: "a-current", type: "assistant", content: [], time: { created: 4 } },
    { id: "u-future", type: "user", text: "must not select", time: { created: 5 } },
  ];
  assert.equal(
    extractRawUserRequest(messages, "a-current"),
    "RAW CURRENT REQUEST",
  );
});

test("extractRawUserRequest falls back to the latest user message when current assistant is not hydrated", () => {
  const messages = [
    { id: "u-old", type: "user", text: "old", time: { created: 1 } },
    { id: "a-old", type: "assistant", content: [], time: { created: 2 } },
    { id: "u-current", type: "user", text: "RAW CURRENT REQUEST", time: { created: 3 } },
  ];
  assert.equal(
    extractRawUserRequest(messages, "a-current-not-yet-hydrated"),
    "RAW CURRENT REQUEST",
  );
});

test("toolMessageIDFrom uses the OpenCode V2 ToolContext messageID", () => {
  assert.equal(toolMessageIDFrom({ messageID: "a2" }), "a2");
  assert.equal(toolMessageIDFrom({}), undefined);
});

// --- runIntake fallback ---

test("missing api key falls back without blocking (non-trivial -> enrich)", async () => {
  await withEnv({ OPENROUTER_API_KEY: undefined, ANDMAR_INTAKE_TRACE: undefined }, async () => {
    assert.equal(readApiKey(), "");
    const decision = await runIntake("Agrega validación al formulario con criterios poco claros", {}, {}, memoryState());
    assert.equal(decision.source, "fallback");
    assert.equal((decision as { jevAvailable: boolean }).jevAvailable, false);
    assert.equal(decision.reason, "missing_api_key");
    assert.equal(decision.jevCalled, false);
    assert.equal(decision.needsRefinement, true);
    assert.equal(decision.mode, "enrich");
    assert.equal(decision.workProjection.mode, "lightweight");
    assert.equal(decision.workProjection.preserveSource, true);
    assert.equal(decision.brief.required, true);
    assert.ok(decision.routeSignals.kind);
  });
});

test("long request with missing Jev key still requires full-request refinement", async () => {
  await withEnv({ OPENROUTER_API_KEY: undefined, ANDMAR_INTAKE_TRACE: undefined }, async () => {
    const request = `Implementa un cambio con especificación extensa.\n${"x".repeat(MAX_STATE_CHARS + 256)}`;
    const decision = await runIntake(request, {}, {}, memoryState());
    assert.equal(decision.source, "fallback");
    assert.equal(decision.reason, "missing_api_key");
    assert.equal(decision.needsRefinement, true);
    assert.equal(decision.mode, "structure");
    assert.equal(decision.workProjection.mode, "structured");
    assert.equal(decision.workProjection.preserveSource, true);
    assert.equal(decision.brief.required, true);
  });
});

test("invalid Jev response falls back with jevCalled true", async () => {
  await withEnv({ OPENROUTER_API_KEY: "test-key", ANDMAR_INTAKE_TRACE: undefined }, async () => {
    const bad = async () => ({ ok: true, status: 200, json: async () => ({ answers: { nope: true } }), text: async () => "{}" });
    const original = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = bad;
    try {
      const decision = await runIntake("Migra este plugin a OpenCode v2 con detalles vagos", {}, {}, memoryState());
      assert.equal(decision.source, "fallback");
      assert.equal(decision.reason, "invalid_response");
      assert.equal(decision.jevCalled, true);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
  });
});

test("successful Jev call returns jev decision", async () => {
  await withEnv({ OPENROUTER_API_KEY: "test-key", ANDMAR_INTAKE_TRACE: undefined }, async () => {
    const original = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = mockFetchSuccess(jevAnswers({
      task_kind: { type: "choice", choice: "migration" },
      needs_refinement: { type: "noul", noul: 0.9 },
      external_contract: { type: "noul", noul: 0.95 },
    })) as never;
    try {
      const decision = await runIntake("Migra este plugin a OpenCode v2", {}, {}, memoryState());
      assert.equal(decision.source, "jev");
      assert.equal(decision.taskKind, "migration");
      assert.equal(decision.needsRefinement, true);
      assert.equal(decision.externalContract, true);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
  });
});

test("long Jev request cannot be declared sufficient from truncated decision context", async () => {
  await withEnv({ OPENROUTER_API_KEY: "test-key", ANDMAR_INTAKE_TRACE: undefined }, async () => {
    const original = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = mockFetchSuccess(jevAnswers({
      needs_refinement: { type: "noul", noul: 0.01 },
      specification_sufficiency: { type: "score", score: 4 },
    })) as never;
    try {
      const request = `Implementa un cambio con especificación extensa.\n${"x".repeat(MAX_STATE_CHARS + 256)}`;
      const decision = await runIntake(request, {}, {}, memoryState());
      assert.equal(decision.source, "jev");
      assert.equal(decision.mode, "structure");
      assert.equal(decision.workProjection.mode, "structured");
      assert.equal(decision.workProjection.preserveSource, true);
      assert.equal(decision.needsRefinement, true);
      assert.equal(decision.brief.required, true);
      assert.ok(decision.specificationSufficiency <= 2);
      assert.equal(decision.reason, "decision_context_truncated");
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
  });
});

// --- trace ---

test("trace disabled stores nothing", async () => {
  await withEnv({ ANDMAR_INTAKE_TRACE: undefined, ANDMAR_INTAKE_TRACE_CONTENT: undefined }, async () => {
    assert.equal(isTraceEnabled(), false);
    const state = memoryState();
    const entry = buildTraceEntry({
      sessionID: "s1", request: "Cambia Save por Guardar", jevModel: DEFAULT_JEV_MODEL,
      jevCalled: false, jevAvailable: true, source: "deterministic", latencyMs: 1,
      rawAnswers: {}, refine: false,
    });
    assert.equal(await saveTrace(state, entry), false);
    assert.deepEqual(await listTraces(state, 10), []);
  });
});

test("trace enabled stores decision without prompt by default", async () => {
  await withEnv({ ANDMAR_INTAKE_TRACE: "1", ANDMAR_INTAKE_TRACE_CONTENT: undefined }, async () => {
    assert.equal(isTraceEnabled(), true);
    assert.equal(includeTraceContent(), false);
    const state = memoryState();
    const secretRequest = "UNIQUE-PROMPT-STRING-ABC-123 cambia algo";
    const entry = buildTraceEntry({
      sessionID: "s1", request: secretRequest, jevModel: DEFAULT_JEV_MODEL,
      jevCalled: true, jevAvailable: true, source: "jev", latencyMs: 84,
      rawAnswers: jevAnswers({ task_kind: { type: "choice", choice: "migration", confidence: 0.94, probabilities: { migration: 0.94 } } }),
      refine: true, taskKind: "migration", needsRefinement: true, externalContract: true, productDecisionMissing: false,
    });
    assert.equal(await saveTrace(state, entry), true);
    const listed = await listTraces(state, 10);
    assert.equal(listed.length, 1);
    const json = JSON.stringify(listed[0]);
    assert.ok(!json.includes(secretRequest));
    assert.equal((listed[0] as { request?: string }).request, undefined);
    assert.equal(listed[0]?.requestHash, hashRequest(secretRequest));
    assert.equal(listed[0]?.requestLength, secretRequest.length);
    assert.equal(listed[0]?.answers["task_kind"]?.choice, "migration");
  });
});

test("trace content appears only with explicit opt-in", async () => {
  await withEnv({ ANDMAR_INTAKE_TRACE: "1", ANDMAR_INTAKE_TRACE_CONTENT: "1" }, async () => {
    const state = memoryState();
    const entry = buildTraceEntry({
      sessionID: "s1", request: "FULL-CONTENT-XYZ", jevModel: DEFAULT_JEV_MODEL,
      jevCalled: true, jevAvailable: true, source: "jev", latencyMs: 5,
      rawAnswers: jevAnswers(), refine: false,
    });
    await saveTrace(state, entry);
    const listed = await listTraces(state, 10);
    assert.equal(listed[0]?.request, "FULL-CONTENT-XYZ");
  });
});

test("secrets never appear in trace", async () => {
  await withEnv({ ANDMAR_INTAKE_TRACE: "1", ANDMAR_INTAKE_TRACE_CONTENT: "1", OPENROUTER_API_KEY: "sk-or-v1-SECRET-TRACE-CHECK" }, async () => {
    const state = memoryState();
    const entry = buildTraceEntry({
      sessionID: "s1", request: "check secrets", jevModel: DEFAULT_JEV_MODEL,
      jevCalled: false, jevAvailable: false, source: "fallback", reason: "missing_api_key",
      latencyMs: 1, rawAnswers: {}, refine: false,
    });
    await saveTrace(state, entry);
    const json = JSON.stringify(await listTraces(state, 10));
    assert.equal(traceContainsSecret(json, [process.env["OPENROUTER_API_KEY"]]), false);
    assert.ok(!json.includes("SECRET-TRACE-CHECK"));
  });
});

test("trace keeps only a small bounded history", async () => {
  await withEnv({ ANDMAR_INTAKE_TRACE: "1", ANDMAR_INTAKE_TRACE_CONTENT: undefined }, async () => {
    const state = memoryState();
    for (let i = 0; i < MAX_TRACE_ENTRIES + 5; i++) {
      await saveTrace(state, buildTraceEntry({
        sessionID: `s${i}`, request: `request ${i}`, jevModel: DEFAULT_JEV_MODEL,
        jevCalled: false, jevAvailable: true, source: "deterministic", latencyMs: 1,
        rawAnswers: {}, refine: false, at: Date.now() + i,
      }));
    }
    const listed = await listTraces(state, 20);
    assert.ok(listed.length <= MAX_TRACE_ENTRIES);
  });
});

test("fallback decision carries routing-compatible signals", () => {
  const decision = decisionFallback({ request: "Agrega login con Google", jevModel: DEFAULT_JEV_MODEL, reason: "missing_api_key", jevCalled: false });
  assert.ok(["feature", "security", "internal", "migration"].includes(decision.taskKind));
  assert.equal(decision.routeSignals.kind, decision.taskKind);
  assert.ok(["low", "medium", "high", "critical"].includes(decision.routeSignals.risk));
});

test("continuation questions are conditional and not in the base seven", () => {
  assert.deepEqual([...INTAKE_QUESTION_IDS], ["task_kind", "needs_refinement", "specification_sufficiency", "risk", "external_contract", "product_decision_missing", "request_shape"]);
  assert.ok(CONTINUATION_QUESTIONS.continuation_relation);
  assert.ok(CONTINUATION_QUESTIONS.continuation_mutation);
  assert.ok(CONTINUATION_QUESTIONS.continuation_new_requirement);
  assert.equal(CONTINUATION_QUESTIONS.continuation_relation.type, "choice");
  assert.equal(CONTINUATION_QUESTIONS.continuation_new_requirement.type, "noul");
  assert.ok(!([...INTAKE_QUESTION_IDS] as string[]).some((id) => id.startsWith("continuation_")));
});

test("deterministicContinuation accepts obvious operational requests", () => {
  for (const req of ["sube y versiona", "versiona y sube", "push", "haz commit", "commit y push", "actualiza la versión", "crea el tag"]) {
    const c = deterministicContinuation(req);
    assert.ok(c, req);
    assert.equal(c?.relation, "operational_continuation");
    assert.equal(c?.fastPath, true);
    assert.equal(c?.source, "deterministic");
  }
  const main = deterministicContinuation("sube y versiona");
  assert.deepEqual(main, {
    previousTaskCompleted: true,
    relation: "operational_continuation",
    mutation: "metadata_and_operational",
    newRequirement: false,
    newRequirementProb: 0,
    fastPath: true,
    source: "deterministic",
    confidence: 1,
  });
});

test("deterministicContinuation rejects new-requirement wording", () => {
  assert.equal(deterministicContinuation("antes de subir corrige también el login"), undefined);
  assert.equal(deterministicContinuation("versiona pero arregla primero los tests"), undefined);
  assert.equal(deterministicContinuation("haz cambios necesarios y publica"), undefined);
});

test("completed contract + obvious operational fast-paths without Jev", async () => {
  await withEnv({ OPENROUTER_API_KEY: "test-key", ANDMAR_INTAKE_TRACE: undefined }, async () => {
    const state = memoryState();
    await state.set("task-contract/ses-op", {
      id: "tc-ses-op", sessionID: "ses-op", goal: "done", requirements: [], constraints: [],
      reviewRequired: false, status: "completed", createdAt: 1, updatedAt: 1,
    });
    let jevCalled = false;
    const original = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = (async () => { jevCalled = true; throw new Error("must not call Jev"); }) as never;
    try {
      const decision = await runIntake("sube y versiona", { sessionID: "ses-op" }, {}, state);
      assert.equal(decision.continuation?.fastPath, true);
      assert.equal(decision.taskKind, "internal");
      assert.equal(decision.continuation?.source, "deterministic");
      assert.equal(jevCalled, false);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
  });
});

test("completed contract + ambiguous Jev operational uses one Jev call and fast-paths", async () => {
  await withEnv({ OPENROUTER_API_KEY: "test-key", ANDMAR_INTAKE_TRACE: undefined }, async () => {
    const state = memoryState();
    await state.set("task-contract/ses-amb", {
      id: "tc-ses-amb", sessionID: "ses-amb", goal: "done", requirements: [], constraints: [],
      reviewRequired: false, status: "completed", createdAt: 1, updatedAt: 1,
    });
    let calls = 0;
    let seenQuestions: string[] = [];
    let seenState = "";
    const original = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = (async (_url: string, init: { body: string }) => {
      calls += 1;
      const body = JSON.parse(init.body);
      seenQuestions = Object.keys(body.questions);
      seenState = body.state;
      return {
        ok: true, status: 200,
        json: async () => ({
          model: "typesafe/jev-1.13-20260917",
          answers: {
            ...jevAnswers(),
            continuation_relation: { type: "choice", choice: "operational_continuation", confidence: 0.9 },
            continuation_mutation: { type: "choice", choice: "metadata_and_operational", confidence: 0.85 },
            continuation_new_requirement: { type: "noul", noul: 0.05 },
          },
        }),
        text: async () => "ok",
      };
    }) as never;
    try {
      const decision = await runIntake("podrías subir y versionar por favor", { sessionID: "ses-amb" }, {}, state);
      assert.equal(calls, 1);
      assert.ok(seenQuestions.includes("task_kind"));
      assert.ok(seenQuestions.includes("continuation_relation"));
      assert.ok(!seenState.includes("REQ-"));
      assert.equal(decision.continuation?.fastPath, true);
      assert.equal(decision.taskKind, "internal");
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
  });
});

test("completed contract + Jev task_extension does not fast-path", () => {
  const cont = parseContinuationAnswers({
    continuation_relation: { type: "choice", choice: "task_extension", confidence: 0.9 },
    continuation_mutation: { type: "choice", choice: "code_or_behavior", confidence: 0.9 },
    continuation_new_requirement: { type: "noul", noul: 0.9 },
  });
  assert.equal(cont.fastPath, false);
  const base = decisionDeterministic("Cambia Save por Guardar", DEFAULT_JEV_MODEL);
  const applied = withContinuationDecision(base, cont);
  assert.equal(applied.continuation?.fastPath, false);
  assert.notEqual(applied.taskKind, "internal");
});

test("no completed contract + operational wording does not silent fast-path", async () => {
  await withEnv({ OPENROUTER_API_KEY: "test-key", ANDMAR_INTAKE_TRACE: undefined }, async () => {
    const original = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = mockFetchSuccessForContinuation() as never;
    try {
      const decision = await runIntake("sube y versiona", { sessionID: "ses-fresh" }, {}, memoryState());
      assert.equal(decision.continuation, undefined);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
  });
});

function mockFetchSuccessForContinuation() {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: "typesafe/jev-1.13-20260917",
      answers: {
        task_kind: { type: "choice", choice: "internal", confidence: 0.8 },
        needs_refinement: { type: "noul", noul: 0.1 },
        specification_sufficiency: { type: "score", score: 3 },
        risk: { type: "score", score: 1 },
        external_contract: { type: "noul", noul: 0.2 },
        product_decision_missing: { type: "noul", noul: 0.1 },
        request_shape: { type: "choice", choice: "compact" },
      },
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    text: async () => "ok",
  });
}

// --- Work Ledger evolution & 0.8.1 hardening: direct | enrich | structure ---

test("deriveIntakeMode: priority 1 — continuation fast path is strictly direct", () => {
  assert.equal(deriveIntakeMode({ requestLength: 20, continuationFastPath: true }), "direct");
  assert.equal(deriveIntakeMode({ requestLength: 10_000, continuationFastPath: true, requestShape: "structured" }), "direct");
});

test("deriveIntakeMode: priority 2 — requests exceeding MAX_STATE_CHARS are strictly structure", () => {
  assert.equal(deriveIntakeMode({ requestLength: MAX_STATE_CHARS + 1, needsRefinement: false, specificationSufficiency: 4 }), "structure");
  assert.equal(deriveIntakeMode({ requestLength: MAX_STATE_CHARS + 500, trivial: true }), "structure");
  assert.equal(deriveIntakeMode({ requestLength: MAX_STATE_CHARS + 20, requestShape: "compact" }), "structure");
});

test("deriveIntakeMode: priority 3 — trivial deterministic bypass is direct", () => {
  assert.equal(deriveIntakeMode({ requestLength: 25, trivial: true }), "direct");
});

test("deriveIntakeMode: priority 4 — structured requestShape yields structure even under MAX_STATE_CHARS", () => {
  assert.equal(deriveIntakeMode({
    requestLength: 4_000,
    requestShape: "structured",
    needsRefinement: false,
    specificationSufficiency: 4,
  }), "structure");
});

test("deriveIntakeMode: priority 5 — low sufficiency (<= 2) cannot be direct and yields enrich", () => {
  assert.equal(deriveIntakeMode({ requestLength: 100, needsRefinement: false, specificationSufficiency: 1 }), "enrich");
  assert.equal(deriveIntakeMode({ requestLength: 100, needsRefinement: false, specificationSufficiency: 2 }), "enrich");
  assert.equal(deriveIntakeMode({ requestLength: 100, needsRefinement: false, specificationSufficiency: 2, requestShape: "compact" }), "enrich");
  assert.equal(deriveIntakeMode({ requestLength: 100, requestShape: "underspecified", specificationSufficiency: 4 }), "enrich");
  assert.equal(deriveIntakeMode({ requestLength: 100, needsRefinement: true, specificationSufficiency: 4 }), "enrich");
});

test("deriveIntakeMode: priority 6 — coherent sufficiency yields direct", () => {
  assert.equal(deriveIntakeMode({ requestLength: 100, needsRefinement: false, specificationSufficiency: 3, requestShape: "compact" }), "direct");
  assert.equal(deriveIntakeMode({ requestLength: 100, needsRefinement: false, specificationSufficiency: 4, requestShape: "compact" }), "direct");
});

test("test 1: fallback non-trivial yields enrich mode with lightweight workProjection", async () => {
  await withEnv({ OPENROUTER_API_KEY: undefined, ANDMAR_INTAKE_TRACE: undefined }, async () => {
    const decision = await runIntake("Agrega validación al formulario con criterios poco claros", {}, {}, memoryState());
    assert.equal(decision.source, "fallback");
    assert.equal(decision.mode, "enrich");
    assert.equal(decision.needsRefinement, true);
    assert.equal(decision.workProjection.mode, "lightweight");
    assert.equal(decision.workProjection.preserveSource, true);
    assert.equal(decision.brief.required, true);
  });
});

test("test 2: trivial fallback/bypass remains direct with none workProjection", () => {
  const request = "Cambia Save por Guardar";
  assert.equal(isTrivialBypass(request), true);
  const decision = decisionDeterministic(request, DEFAULT_JEV_MODEL);
  assert.equal(decision.mode, "direct");
  assert.equal(decision.needsRefinement, false);
  assert.equal(decision.workProjection.mode, "none");
  assert.equal(decision.workProjection.preserveSource, false);
  assert.equal(decision.brief.required, false);

  const fallbackDecision = decisionFallback({
    request,
    jevModel: DEFAULT_JEV_MODEL,
    reason: "missing_api_key",
    jevCalled: false,
  });
  assert.equal(fallbackDecision.mode, "direct");
  assert.equal(fallbackDecision.needsRefinement, false);
  assert.equal(fallbackDecision.workProjection.mode, "none");
});

test("test 3: low sufficiency cannot be direct", () => {
  assert.equal(deriveIntakeMode({ requestLength: 100, needsRefinement: false, specificationSufficiency: 1 }), "enrich");
  assert.equal(deriveIntakeMode({ requestLength: 100, needsRefinement: false, specificationSufficiency: 2 }), "enrich");
});

test("test 4: coherent sufficient request yields direct", () => {
  assert.equal(deriveIntakeMode({ requestLength: 100, needsRefinement: false, specificationSufficiency: 3, requestShape: "compact" }), "direct");
  assert.equal(deriveIntakeMode({ requestLength: 100, needsRefinement: false, specificationSufficiency: 4, requestShape: "compact" }), "direct");
});

test("test 5: structured spec under MAX_STATE_CHARS yields structure mode from Jev", () => {
  const parsed = parseJevAnswers(jevAnswers({
    request_shape: { type: "choice", choice: "structured" },
    needs_refinement: { type: "noul", noul: 0.1 },
    specification_sufficiency: { type: "score", score: 4 },
  }));
  const decision = decisionFromJev(parsed, { jevModel: DEFAULT_JEV_MODEL, latencyMs: 50, requestLength: 4_500 });
  assert.equal(decision.mode, "structure");
  assert.equal(decision.needsRefinement, true);
  assert.equal(decision.workProjection.mode, "structured");
  assert.equal(decision.workProjection.preserveSource, true);
  assert.equal(decision.brief.required, true);
});

test("test 6: underspecified shape from Jev yields enrich mode even if short", () => {
  const parsed = parseJevAnswers(jevAnswers({
    request_shape: { type: "choice", choice: "underspecified" },
    needs_refinement: { type: "noul", noul: 0.8 },
    specification_sufficiency: { type: "score", score: 2 },
  }));
  const decision = decisionFromJev(parsed, { jevModel: DEFAULT_JEV_MODEL, latencyMs: 50, requestLength: 120 });
  assert.equal(decision.mode, "enrich");
  assert.equal(decision.needsRefinement, true);
  assert.equal(decision.workProjection.mode, "lightweight");
  assert.equal(decision.workProjection.preserveSource, true);
});

test("test 7: long detailed request > MAX_STATE_CHARS yields structure mode even if Jev answers compact and sufficient", async () => {
  await withEnv({ OPENROUTER_API_KEY: "test-key", ANDMAR_INTAKE_TRACE: undefined }, async () => {
    const original = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = mockFetchSuccess(jevAnswers({
      request_shape: { type: "choice", choice: "compact" },
      needs_refinement: { type: "noul", noul: 0.01 },
      specification_sufficiency: { type: "score", score: 4 },
    })) as never;
    try {
      const longRequest = `Especificación detallada de requisitos del sistema.\n${"Obligación técnica explícita: validar los datos.\n".repeat(250)}`;
      assert.ok(longRequest.length > MAX_STATE_CHARS);
      const decision = await runIntake(longRequest, {}, {}, memoryState());
      assert.equal(decision.mode, "structure");
      assert.equal(decision.workProjection.mode, "structured");
      assert.equal(decision.workProjection.preserveSource, true);
      assert.equal(decision.needsRefinement, true);
      assert.equal(decision.brief.required, true);
      assert.equal(decision.reason, "decision_context_truncated");
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
  });
});

test("test 8: operational continuation after completed contract yields direct mode and fastPath", async () => {
  const state = memoryState();
  const sessionID = "ses-completed-123";
  await state.set(`task-contract/${sessionID}`, {
    sessionID,
    taskKind: "feature",
    goal: "add login",
    status: "completed",
    revision: "rev-1",
    requirements: [],
    constraints: [],
  });

  const decision = await runIntake("commit y push", { sessionID }, {}, state);
  assert.equal(decision.continuation?.fastPath, true);
  assert.equal(decision.mode, "direct");
  assert.equal(decision.workProjection.mode, "none");
  assert.equal(decision.workProjection.preserveSource, false);
  assert.equal(decision.needsRefinement, false);
  assert.equal(decision.brief.required, false);
});

test("test 9: invalid or missing request_shape throws invalid_response", () => {
  assert.throws(
    () => parseJevAnswers(jevAnswers({ request_shape: { type: "choice", choice: "invalid-shape" } })),
    /invalid_response:request_shape/,
  );
  const withoutShape = jevAnswers();
  delete withoutShape["request_shape"];
  assert.throws(
    () => parseJevAnswers(withoutShape),
    /invalid_response:missing:request_shape/,
  );
});

test("test 10: trace records mode and workProjectionMode with prompt content absent by default", async () => {
  await withEnv({ ANDMAR_INTAKE_TRACE: "1", ANDMAR_INTAKE_TRACE_CONTENT: undefined }, async () => {
    const state = memoryState();
    const requestText = "Agrega autenticación robusta al API";
    const decision = await runIntake(requestText, { sessionID: "trace-session" }, {}, state);
    const traces = await listTraces(state, 5);
    assert.ok(traces.length >= 1);
    const latest = traces[0];
    assert.ok(latest);
    assert.equal(latest.mode, decision.mode);
    assert.equal(latest.workProjectionMode, decision.workProjection.mode);
    assert.equal(latest.decision.mode, decision.mode);
    assert.equal(latest.decision.workProjectionMode, decision.workProjection.mode);
    assert.equal(latest.request, undefined);
    assert.equal(latest.requestHash, hashRequest(requestText));
  });
});
