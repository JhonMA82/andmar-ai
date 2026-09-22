// Child-session task runner (pure helper over the injected OpenCode session
// domain; core never imports the OpenCode plugin package).
//
// Verified against the installed pinned plugin package (2.0.4) generated
// client types:
// - `session.prompt({ sessionID, text })` QUEUES the user message and
//   resolves immediately with a `SessionInboxUser` record — it does NOT
//   return the child's answer.
// - `session.wait({ sessionID })` resolves when the session goes idle.
// - `session.context({ sessionID })` returns the session messages
//   (`SessionMessageInfo[]`); assistant messages carry
//   `content: [{ type: "text" | "reasoning" | "tool", ... }]` with
//   `finish?: "stop" | ...`.
//
// So the correct way to get a child's answer is prompt -> wait -> context.
// A bounded idle race remains (wait may resolve while the queued message is
// still starting), so the last assistant completion is checked against the
// prompt timestamp and re-waited briefly.

export interface SessionDomainLike {
  prompt(input: { sessionID: string; text: string }): Promise<unknown>
  wait?(input: { sessionID: string }): Promise<unknown>
  context?(input: { sessionID: string }): Promise<unknown>
}

const MAX_WAIT_MS = 10 * 60_000
const RETRY_DELAY_MS = 1_000

interface AssistantLike {
  type?: unknown
  time?: { created?: unknown; completed?: unknown }
  content?: unknown
  parts?: unknown
  finish?: unknown
}

function textFromAssistant(message: AssistantLike): string {
  const sources: unknown[] = Array.isArray(message.content) ? message.content : Array.isArray(message.parts) ? message.parts : []
  const text = sources
    .map((part) => part as { type?: unknown; text?: unknown })
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => (part as { text: string }).text)
    .join("\n")
    .trim()
  return text
}

function lastAssistantText(messages: unknown): { text: string | undefined; completedAt: number } {
  if (!Array.isArray(messages)) return { text: undefined, completedAt: 0 }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as AssistantLike | undefined
    if (!message || typeof message !== "object" || message.type !== "assistant") continue
    const text = textFromAssistant(message)
    const completedAt = typeof message.time?.completed === "number" ? message.time.completed : 0
    if (text !== "" || completedAt > 0) return { text: text === "" ? undefined : text, completedAt }
  }
  return { text: undefined, completedAt: 0 }
}

/**
 * Run one bounded child task: queue the prompt, wait for idle, then extract
 * the child's final text from the session messages. Returns `undefined` when
 * the child produced no final text (caller decides how to report it).
 * When `wait`/`context` are unavailable on the host session domain, falls
 * back to the prompt result's own text shape (legacy tolerance).
 */
export async function runChildTask(
  sessions: SessionDomainLike,
  sessionID: string,
  text: string,
): Promise<string | undefined> {
  if (typeof sessions?.prompt !== "function") return undefined
  const startedAt = Date.now()
  const queued = await sessions.prompt({ sessionID, text })

  const canWait = typeof sessions.wait === "function"
  const canRead = typeof sessions.context === "function"
  if (!canWait || !canRead) {
    // Legacy/fallback shape: the host resolved the prompt with a result that
    // may carry text parts directly.
    const direct = queued as { parts?: unknown; message?: { parts?: unknown }; text?: unknown; content?: unknown }
    const textLike = { content: direct.content, parts: direct.parts ?? direct.message?.parts } as AssistantLike
    const fallback = textFromAssistant(textLike)
    if (fallback !== "") return fallback
    if (typeof direct.text === "string" && direct.text.trim() !== "") return direct.text
    return undefined
  }

  const deadline = startedAt + MAX_WAIT_MS
  let last: { text: string | undefined; completedAt: number } = { text: undefined, completedAt: 0 }
  while (Date.now() < deadline) {
    await sessions.wait!({ sessionID })
    const messages = await sessions.context!({ sessionID })
    last = lastAssistantText(messages)
    // Only accept an assistant completion produced by this prompt; a wait
    // that resolved before the queued message even started must be retried.
    // An unknown completion timestamp (0) is trusted: the wait() already
    // reported idle, and review sessions have no prior text to confuse.
    const fresh = last.completedAt === 0 || last.completedAt >= startedAt - 1_000
    if (last.text !== undefined && fresh) return last.text
    if (!fresh) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      continue
    }
    // Fresh but empty text: the child finished without emitting text.
    return undefined
  }
  return last.text
}
