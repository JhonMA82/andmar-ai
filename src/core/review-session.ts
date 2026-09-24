// Specialized bounded runner for independent review sessions.
//
// Review is not delegation: it audits a closed candidate and should either
// return one final response or become explicitly unavailable. Keep this
// lifecycle separate from the generic child-task runner used by delegation.

export interface ReviewSessionDomainLike {
  prompt(input: { sessionID: string; text: string }): Promise<unknown>
  wait?(input: { sessionID: string }): Promise<unknown>
  context?(input: { sessionID: string }): Promise<unknown>
}

export type ReviewStage = "session.prompt" | "session.wait" | "session.context"

export interface ReviewCompleted {
  status: "completed"
  elapsedMs: number
  text?: string | undefined
}

export interface ReviewUnavailable {
  status: "unavailable"
  reason: "deadline_exceeded"
  stage: ReviewStage
  elapsedMs: number
}

export type ReviewRunResult = ReviewCompleted | ReviewUnavailable

interface AssistantLike {
  type?: unknown
  content?: unknown
  parts?: unknown
}

class ReviewDeadlineError extends Error {
  readonly stage: ReviewStage

  constructor(stage: ReviewStage) {
    super(`review deadline exceeded during ${stage}`)
    this.name = "ReviewDeadlineError"
    this.stage = stage
  }
}

function timeoutLike(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /timeout|timed out|deadline/i.test(`${error.name} ${error.message}`)
}

async function runStage<T>(
  operation: () => Promise<T>,
  deadline: number,
  stage: ReviewStage,
): Promise<T> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new ReviewDeadlineError(stage)

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new ReviewDeadlineError(stage)), remaining)
      }),
    ])
  } catch (error) {
    if (error instanceof ReviewDeadlineError) throw error
    if (timeoutLike(error)) throw new ReviewDeadlineError(stage)
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function textFromAssistant(message: AssistantLike): string | undefined {
  const parts: unknown[] = Array.isArray(message.content)
    ? message.content
    : Array.isArray(message.parts)
      ? message.parts
      : []
  const text = parts
    .map((part) => part as { type?: unknown; text?: unknown })
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => (part as { text: string }).text)
    .join("\n")
    .trim()
  return text === "" ? undefined : text
}

function lastAssistant(messages: unknown): { seen: boolean; text?: string | undefined } {
  if (!Array.isArray(messages)) return { seen: false }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as AssistantLike | undefined
    if (!message || typeof message !== "object" || message.type !== "assistant") continue
    const text = textFromAssistant(message)
    return text === undefined ? { seen: true } : { seen: true, text }
  }
  return { seen: false }
}

function directText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const direct = value as {
    parts?: unknown
    message?: { parts?: unknown }
    text?: unknown
    content?: unknown
  }
  const fromParts = textFromAssistant({
    content: direct.content,
    parts: direct.parts ?? direct.message?.parts,
  })
  if (fromParts !== undefined) return fromParts
  if (typeof direct.text === "string" && direct.text.trim() !== "") return direct.text.trim()
  return undefined
}

/**
 * Run one review attempt with a single wall-clock budget.
 *
 * Fresh review sessions can hit an idle race where the first wait resolves
 * before the queued prompt starts. We tolerate one extra wait/context read;
 * this is not a review retry and never creates another session.
 */
export async function runReview(
  sessions: ReviewSessionDomainLike,
  sessionID: string,
  packet: string,
  timeoutMs: number,
): Promise<ReviewRunResult> {
  const startedAt = Date.now()
  const deadline = startedAt + Math.max(1, timeoutMs)

  try {
    const queued = await runStage(
      () => sessions.prompt({ sessionID, text: packet }),
      deadline,
      "session.prompt",
    )

    if (typeof sessions.wait !== "function" || typeof sessions.context !== "function") {
      const text = directText(queued)
      return text === undefined
        ? { status: "completed", elapsedMs: Date.now() - startedAt }
        : { status: "completed", elapsedMs: Date.now() - startedAt, text }
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await runStage(
        () => sessions.wait!({ sessionID }),
        deadline,
        "session.wait",
      )
      const messages = await runStage(
        () => sessions.context!({ sessionID }),
        deadline,
        "session.context",
      )
      const assistant = lastAssistant(messages)
      if (assistant.seen) {
        return assistant.text === undefined
          ? { status: "completed", elapsedMs: Date.now() - startedAt }
          : { status: "completed", elapsedMs: Date.now() - startedAt, text: assistant.text }
      }
    }

    return { status: "completed", elapsedMs: Date.now() - startedAt }
  } catch (error) {
    if (error instanceof ReviewDeadlineError) {
      return {
        status: "unavailable",
        reason: "deadline_exceeded",
        stage: error.stage,
        elapsedMs: Date.now() - startedAt,
      }
    }
    throw error
  }
}
