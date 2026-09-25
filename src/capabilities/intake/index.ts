import type { Capability, StateStore } from "../../core/contracts.ts";
import { contractKey, type TaskContract } from "../../core/task-contract.ts";
import { callJev, MAX_STATE_CHARS, readApiKey, resolveJevModel, resolveJevTimeout, type RawAnswers } from "./jev.ts";
import {
  decisionDeterministic,
  decisionFallback,
  decisionFromJev,
  decisionRawRequestUnavailable,
  deterministicContinuation,
  isTrivialBypass,
  parseContinuationAnswers,
  parseJevAnswers,
  requireFullRequestReview,
  withContinuationDecision,
  type IntakeDecision,
} from "./decide.ts";
import { CONTINUATION_QUESTIONS } from "./questions.ts";
import { INTAKE_QUESTIONS } from "./questions.ts";
import { buildTraceEntry, isTraceEnabled, listTraces, saveTrace } from "./trace.ts";

const MAX_REQUEST_CHARS = 100_000;

export function toolMessageIDFrom(toolContext: unknown): string | undefined {
  const ctx = toolContext as { messageID?: unknown } | undefined;
  return typeof ctx?.messageID === "string" && ctx.messageID !== ""
    ? ctx.messageID
    : undefined;
}

export function extractRawUserRequest(
  messages: readonly any[],
  currentAssistantMessageID?: string,
): string | undefined {
  let end = messages.length;

  if (currentAssistantMessageID) {
    const assistantIndex = messages.findIndex(
      (message: any) => message?.id === currentAssistantMessageID,
    );
    if (assistantIndex >= 0) end = assistantIndex;
  }

  for (let index = end - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "user") continue;
    if (typeof message?.text !== "string") continue;

    const text = message.text.trim();
    if (text !== "") return text;
  }

  return undefined;
}

function sessionIDFrom(toolContext: unknown): string {
  const ctx = toolContext as { sessionID?: unknown; session?: { id?: unknown }; metadata?: { sessionID?: unknown } } | undefined;
  if (typeof ctx?.sessionID === "string" && ctx.sessionID !== "") return ctx.sessionID;
  if (typeof ctx?.session?.id === "string" && ctx.session.id !== "") return ctx.session.id as string;
  if (typeof ctx?.metadata?.sessionID === "string" && ctx.metadata.sessionID !== "") return ctx.metadata.sessionID as string;
  return "unknown";
}

function intakeOptions(config: unknown): { model?: unknown; timeoutMs?: unknown } {
  const intake = (config as { intake?: unknown })?.intake;
  if (typeof intake !== "object" || intake === null) return {};
  const record = intake as Record<string, unknown>;
  return { model: record["model"], timeoutMs: record["timeoutMs"] };
}

function errorReason(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  if (code === "missing_api_key") return "missing_api_key";
  if (code === "timeout") return "timeout";
  if (code === "auth_failed") return "auth_failed";
  if (code === "invalid_response") return "invalid_response";
  if (typeof (error as Error)?.message === "string") {
    const message = ((error as Error).message ?? "").split(":")[0] ?? "";
    if (message === "timeout" || message === "missing_api_key" || message === "invalid_response" || message === "request_failed" || message === "auth_failed") return message;
  }
  return "request_failed";
}

export async function runIntake(
  request: string,
  toolContext: unknown,
  config: unknown,
  state: StateStore,
): Promise<IntakeDecision> {
  const started = Date.now();
  const options = intakeOptions(config);
  const jevModel = resolveJevModel(options.model);
  const sessionID = sessionIDFrom(toolContext);

  const tooLarge = request.length > MAX_REQUEST_CHARS;
  if (request.trim() === "" || tooLarge) {
    const reason = request.trim() === "" ? "invalid_request" : "request_too_large";
    const invalid = decisionFallback({ request, jevModel, reason, jevCalled: false, latencyMs: Date.now() - started });
    if (isTraceEnabled()) {
      await saveTrace(state, buildTraceEntry({
        sessionID, request, jevModel, jevCalled: false, jevAvailable: false,
        source: invalid.source, reason: invalid.reason, latencyMs: Date.now() - started,
        rawAnswers: {}, refine: invalid.needsRefinement, taskKind: invalid.taskKind,
        needsRefinement: invalid.needsRefinement, externalContract: invalid.externalContract,
        productDecisionMissing: invalid.productDecisionMissing,
      }));
    }
    return invalid;
  }

  const previousContract =
    sessionID === "unknown"
      ? undefined
      : await state.get<TaskContract>(contractKey(sessionID));

  const completedContract =
    previousContract?.status === "completed" ? previousContract : undefined;

  if (completedContract) {
    const continuation = deterministicContinuation(request);
    if (continuation) {
      const decision = withContinuationDecision(
        decisionDeterministic(request, jevModel),
        continuation,
      );
      if (isTraceEnabled()) {
        await saveTrace(state, buildTraceEntry({
          sessionID, request, jevModel, jevCalled: false, jevAvailable: true,
          source: decision.source, reason: decision.reason, latencyMs: Date.now() - started,
          rawAnswers: {}, refine: decision.needsRefinement, taskKind: decision.taskKind,
          needsRefinement: decision.needsRefinement, externalContract: decision.externalContract,
          productDecisionMissing: decision.productDecisionMissing,
          continuationFastPath: continuation.fastPath,
          continuationRelation: continuation.relation,
          continuationMutation: continuation.mutation,
          continuationSource: continuation.source,
        }));
      }
      return decision;
    }
  }

  if (!completedContract && isTrivialBypass(request)) {
    const decision = decisionDeterministic(request, jevModel);
    if (isTraceEnabled()) {
      await saveTrace(state, buildTraceEntry({
        sessionID, request, jevModel, jevCalled: false, jevAvailable: true,
        source: decision.source, reason: decision.reason, latencyMs: Date.now() - started,
        rawAnswers: {}, refine: decision.needsRefinement, taskKind: decision.taskKind,
        needsRefinement: decision.needsRefinement, externalContract: decision.externalContract,
        productDecisionMissing: decision.productDecisionMissing,
      }));
    }
    return decision;
  }

  const apiKey = readApiKey();
  if (apiKey === "") {
    const decision = requireFullRequestReview(
      decisionFallback({ request, jevModel, reason: "missing_api_key", jevCalled: false, latencyMs: Date.now() - started }),
      request.length,
      MAX_STATE_CHARS,
    );
    if (isTraceEnabled()) {
      await saveTrace(state, buildTraceEntry({
        sessionID, request, jevModel, jevCalled: false, jevAvailable: false,
        source: decision.source, reason: decision.reason, latencyMs: Date.now() - started,
        rawAnswers: {}, refine: decision.needsRefinement, taskKind: decision.taskKind,
        needsRefinement: decision.needsRefinement, externalContract: decision.externalContract,
        productDecisionMissing: decision.productDecisionMissing,
      }));
    }
    return decision;
  }

  const timeoutMs = resolveJevTimeout(options.timeoutMs);
  try {
    const questions = completedContract
      ? { ...INTAKE_QUESTIONS, ...CONTINUATION_QUESTIONS }
      : undefined;
    const jevState = completedContract
      ? JSON.stringify({
        request,
        previousTask: {
          status: "completed",
          taskKind: (completedContract as { taskKind?: unknown }).taskKind ?? "internal",
        },
      })
      : request;
    const result = await callJev(jevState, { model: jevModel, apiKey, timeoutMs, ...(questions === undefined ? {} : { questions }) });
    const parsed = parseJevAnswers(result.answers as RawAnswers);
    let decision = decisionFromJev(parsed, { jevModel: result.modelReturned, latencyMs: result.latencyMs });
    const decisionContextPartial = request.length > MAX_STATE_CHARS;
    if (completedContract) {
      const continuation = parseContinuationAnswers(result.answers as RawAnswers);
      decision = decisionContextPartial
        ? { ...decision, continuation: { ...continuation, fastPath: false } }
        : withContinuationDecision(decision, continuation);
    }
    decision = requireFullRequestReview(decision, request.length, MAX_STATE_CHARS);
    if (isTraceEnabled()) {
      await saveTrace(state, buildTraceEntry({
        sessionID, request, jevModel: result.modelReturned, jevCalled: true, jevAvailable: true,
        source: decision.source, latencyMs: result.latencyMs, rawAnswers: result.answers as RawAnswers,
        refine: decision.needsRefinement, taskKind: decision.taskKind,
        needsRefinement: decision.needsRefinement, externalContract: decision.externalContract,
        productDecisionMissing: decision.productDecisionMissing,
        ...(decision.continuation === undefined ? {} : {
          continuationFastPath: decision.continuation.fastPath,
          continuationRelation: decision.continuation.relation,
          continuationMutation: decision.continuation.mutation,
          continuationSource: decision.continuation.source,
        }),
      }));
    }
    return decision;
  } catch (error) {
    const reason = errorReason(error);
    const decision = requireFullRequestReview(
      decisionFallback({ request, jevModel, reason, jevCalled: true, latencyMs: Date.now() - started }),
      request.length,
      MAX_STATE_CHARS,
    );
    if (isTraceEnabled()) {
      await saveTrace(state, buildTraceEntry({
        sessionID, request, jevModel, jevCalled: true, jevAvailable: false,
        source: decision.source, reason, latencyMs: Date.now() - started,
        rawAnswers: {}, refine: decision.needsRefinement, taskKind: decision.taskKind,
        needsRefinement: decision.needsRefinement, externalContract: decision.externalContract,
        productDecisionMissing: decision.productDecisionMissing,
      }));
    }
    return decision;
  }
}

export const intakeCapability: Capability = {
  id: "intake",
  version: 2,
  description: "Request refinement intake: deterministic-first classification with a single structured Jev decision and explicit fallback.",
  async setup({ ctx, config, state }) {
    const registration = await ctx.tool.transform((editor: any) => {
      editor.namespace({ name: "andmar", description: "AndMar AI harness primitives" });
      editor.add({
        name: "intake",
        description: "Classify the current raw user request as sufficient or needing internal refinement. The capability reads the authoritative user message directly from the OpenCode session; callers must not summarize or pass request text. Deterministic first, one structured Jev decision when useful, explicit fallback when unavailable.",
        input: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (_input: Record<string, never>, toolContext: unknown) => {
          const sessionID = sessionIDFrom(toolContext);
          const currentAssistantMessageID = toolMessageIDFrom(toolContext);

          if (sessionID === "unknown") {
            const decision = decisionRawRequestUnavailable(
              resolveJevModel(intakeOptions(config).model),
            );
            return { content: JSON.stringify(decision, null, 2) };
          }

          try {
            const messages = await ctx.session.context({ sessionID });
            const request = extractRawUserRequest(messages, currentAssistantMessageID);

            if (!request) {
              const decision = decisionRawRequestUnavailable(
                resolveJevModel(intakeOptions(config).model),
              );
              return { content: JSON.stringify(decision, null, 2) };
            }

            const decision = await runIntake(request, toolContext, config, state);
            return { content: JSON.stringify(decision, null, 2) };
          } catch {
            const decision = decisionRawRequestUnavailable(
              resolveJevModel(intakeOptions(config).model),
            );
            return { content: JSON.stringify(decision, null, 2) };
          }
        },
      });
      editor.add({
        name: "intake_trace",
        description: "List recent structured intake decisions (request hash, Jev answers, refinement outcome, latency, fallback reason). No prompt content unless ANDMAR_INTAKE_TRACE_CONTENT=1. Never contains secrets.",
        input: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 20 },
          },
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (input: { limit?: number }) => {
          const entries = await listTraces(state, input.limit ?? 10);
          return {
            content: JSON.stringify({ enabled: isTraceEnabled(), count: entries.length, entries }, null, 2),
          };
        },
      });
    });
    return registration && typeof (registration as { dispose?: unknown }).dispose === "function"
      ? () => void (registration as { dispose: () => void }).dispose()
      : undefined;
  },
};

export default intakeCapability;
