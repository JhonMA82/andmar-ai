export type SemanticEventType =
  | "andmar.routing"
  | "andmar.delegation"
  | "andmar.verification"
  | "andmar.completion"
  | "andmar.contract"
  | "andmar.review"

export interface SemanticEventInput {
  type: SemanticEventType
  sessionID?: string | undefined
  payload: Record<string, unknown>
}

export interface SemanticObservability {
  emit(event: SemanticEventInput): void
}

const DEFAULT_URL = "http://localhost:4000"
const SEND_TIMEOUT_MS = 1_000
const MAX_IN_FLIGHT = 8
const MAX_BODY_CHARS = 8_000

function enabled(): boolean {
  return process.env.ANDMAR_OBSERVABILITY_ENABLED !== "0"
}

function endpoint(): string {
  return (process.env.ANDMAR_OBSERVABILITY_URL || DEFAULT_URL).replace(/\/$/, "")
}

function sourceApp(location: any): string {
  const canonical = location?.project?.canonical
  const directory = location?.directory
  const value =
    typeof canonical === "string" && canonical !== ""
      ? canonical
      : typeof directory === "string" && directory !== ""
        ? directory
        : "unknown"
  const normalized = value.replace(/\\/g, "/").replace(/\/$/, "")
  return normalized.split("/").filter(Boolean).pop() || "unknown"
}

function safePayload(payload: Record<string, unknown>): Record<string, unknown> {
  // Semantic events are intentionally metadata-only. The caller contract
  // forbids prompts, commands, code, tool output and reasoning.
  const serialized = JSON.stringify(payload)
  if (serialized.length <= MAX_BODY_CHARS) return payload
  return {
    truncated: true,
    originalChars: serialized.length,
  }
}

export function createSemanticObservability(location: any): SemanticObservability {
  const app = sourceApp(location)
  let inFlight = 0

  return {
    emit(event) {
      if (!enabled()) return
      if (typeof event.sessionID !== "string" || event.sessionID === "") return
      if (inFlight >= MAX_IN_FLIGHT) return

      const body = JSON.stringify({
        source_app: app,
        session_id: event.sessionID,
        event_type: event.type,
        payload: safePayload(event.payload),
      })

      inFlight += 1
      void fetch(`${endpoint()}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      })
        .then(async (response) => {
          // Observability is best-effort. Drain the body but never turn a
          // telemetry failure into an AndMar/runtime failure.
          await response.arrayBuffer().catch(() => undefined)
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight -= 1
        })
    },
  }
}
