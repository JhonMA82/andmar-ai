import type { Capability, StateStore } from "../../core/contracts.ts"
import { contractKey, type TaskContract } from "../../core/task-contract.ts"
import { latestUserText } from "../../core/session.ts"

export type DeliveryOperation =
  | "commit"
  | "push"
  | "pull-request"
  | "merge"
  | "tag"
  | "version"
  | "publish"
  | "release"

const OPERATIONS: readonly DeliveryOperation[] = [
  "commit",
  "push",
  "pull-request",
  "merge",
  "tag",
  "version",
  "publish",
  "release",
]

// A verb-phrase match tolerates a short determiner/quantifier run between the
// verb and the operation noun, so an explicit counted request such as
// "haz los 3 commits" authorizes `commit` exactly as "haz un commit" does.
// The gap never crosses CLAUSE_BREAK, so per-clause negation still governs.
// Nouns are matched plural-tolerantly because an explicit request to commit
// three times is still an explicit request to commit.
const OBJECT_GAP = "[^.;\\n]{0,24}?"
const NOUN: Record<DeliveryOperation, string> = {
  commit: "commits?",
  push: "push(?:es)?",
  "pull-request": "pull\\s+requests?",
  merge: "merges?",
  tag: "tags?",
  version: "versi[oó]n(?:es)?",
  publish: "publish(?:es)?",
  release: "releases?",
}

const POSITIVE: Record<DeliveryOperation, readonly RegExp[]> = {
  commit: [
    new RegExp(`\\b${NOUN.commit}\\b`, "i"),
    /\bcommite(?:a|ar)\b/i,
    new RegExp(`\\b(?:haz|hacer|crea|crear|make|create)\\b${OBJECT_GAP}\\b${NOUN.commit}\\b`, "i"),
  ],
  push: [
    new RegExp(`\\b${NOUN.push}\\b`, "i"),
    /\bpushea(?:r)?\b/i,
    /\bsube\s+(?:los\s+)?cambios\b/i,
    /\bsube\s+(?:la\s+)?rama\b/i,
    /\bsube\s+(?:al|a\s+github|al\s+remoto)\b/i,
    /\bpush\s+it\b/i,
  ],
  "pull-request": [
    new RegExp(`\\b${NOUN["pull-request"]}\\b`, "i"),
    // A bare "pr"/"prs" is deliberately NOT an authorization on its own: it is
    // an abbreviation that appears in unrelated text. It only counts after an
    // explicit open/create verb, as before.
    new RegExp(`\\b(?:abre|abrir|crea|crear|open|create)\\b${OBJECT_GAP}\\bprs?\\b`, "i"),
  ],
  merge: [new RegExp(`\\b${NOUN.merge}\\b`, "i"), /\bmerge(?:a|ar)\b/i, /\bfusiona(?:r)?\b/i],
  tag: [
    new RegExp(`\\b${NOUN.tag}\\b`, "i"),
    new RegExp(`\\b(?:crea|crear|create)\\b${OBJECT_GAP}\\b${NOUN.tag}\\b`, "i"),
    /\betiqueta\s+git\b/i,
  ],
  version: [
    /\bversiona(?:r)?\b/i,
    /\bversion\s+bump\b/i,
    /\bbump\s+(?:the\s+)?version\b/i,
    new RegExp(`\\b(?:incrementa|actualiza|sube)\\b${OBJECT_GAP}\\b${NOUN.version}\\b`, "i"),
  ],
  publish: [
    new RegExp(`\\b${NOUN.publish}\\b`, "i"),
    /\bpublica(?:r)?\s+(?:el\s+)?(?:paquete|package)\b/i,
    /\bpublica(?:r)?\s+en\s+(?:npm|registry)\b/i,
  ],
  release: [
    new RegExp(`\\b${NOUN.release}\\b`, "i"),
    new RegExp(`\\b(?:crea|crear|create|publish)\\b${OBJECT_GAP}\\b${NOUN.release}\\b`, "i"),
    /\blanzamiento\b/i,
  ],
}

const NEGATION = /\b(?:no|nunca|never|don['’]?t|do\s+not|without|sin|evita(?:r)?)\b/i
const CLAUSE_BREAK = /[.;\n]/

function clausePrefix(text: string, index: number): string {
  let start = index
  while (start > 0 && !CLAUSE_BREAK.test(text[start - 1] ?? "")) start -= 1
  return text.slice(start, index)
}

export function deliveryAuthorization(request: string, operation: DeliveryOperation): {
  authorized: boolean
  reason: "explicit-current-user-request" | "explicit-negation" | "operation-not-requested"
} {
  const text = request.trim()
  if (text === "") return { authorized: false, reason: "operation-not-requested" }
  let matched = false
  for (const pattern of POSITIVE[operation]) {
    pattern.lastIndex = 0
    const match = pattern.exec(text)
    if (!match || match.index === undefined) continue
    matched = true
    if (NEGATION.test(clausePrefix(text, match.index))) {
      return { authorized: false, reason: "explicit-negation" }
    }
  }
  return matched
    ? { authorized: true, reason: "explicit-current-user-request" }
    : { authorized: false, reason: "operation-not-requested" }
}

function sessionIDFrom(toolContext: unknown): string | undefined {
  const ctx = toolContext as { sessionID?: unknown; session?: { id?: unknown }; metadata?: { sessionID?: unknown } } | undefined
  if (typeof ctx?.sessionID === "string" && ctx.sessionID !== "") return ctx.sessionID
  if (typeof ctx?.session?.id === "string" && ctx.session.id !== "") return ctx.session.id as string
  if (typeof ctx?.metadata?.sessionID === "string" && ctx.metadata.sessionID !== "") return ctx.metadata.sessionID as string
  return undefined
}

function messageIDFrom(toolContext: unknown): string | undefined {
  const ctx = toolContext as { messageID?: unknown } | undefined
  return typeof ctx?.messageID === "string" && ctx.messageID !== "" ? ctx.messageID : undefined
}

export interface DeliveryDecision {
  allowed: boolean
  operation: DeliveryOperation
  authorization: {
    authorized: boolean
    source: "current-user-request"
    reason: string
  }
  readiness: {
    ready: boolean
    taskContract: "completed" | "active" | "blocked" | "absent"
    source: "completed-task-contract" | "explicit-operational-continuation" | "incomplete-task-contract"
    note?: string
  }
  execution: "opencode-native"
}

export async function evaluateDelivery(
  state: StateStore,
  sessionID: string,
  request: string,
  operation: DeliveryOperation,
): Promise<DeliveryDecision> {
  const authorization = deliveryAuthorization(request, operation)
  const contract = await state.get<TaskContract>(contractKey(sessionID))

  let taskContract: DeliveryDecision["readiness"]["taskContract"] = "absent"
  let source: DeliveryDecision["readiness"]["source"] = "explicit-operational-continuation"
  let ready = true
  let note: string | undefined =
    "No Task Contract is present in this session. Treat this only as an explicitly requested operational continuation/trivial delivery and inspect native repository state before execution."

  if (contract) {
    taskContract = contract.status
    if (contract.status === "completed") {
      source = "completed-task-contract"
      note = undefined
    } else {
      source = "incomplete-task-contract"
      ready = false
      note = `Task Contract is ${contract.status}; finish the normal completion flow before delivery.`
    }
  }

  return {
    allowed: authorization.authorized && ready,
    operation,
    authorization: {
      authorized: authorization.authorized,
      source: "current-user-request",
      reason: authorization.reason,
    },
    readiness: { ready, taskContract, source, ...(note ? { note } : {}) },
    execution: "opencode-native",
  }
}

export const deliveryCapability: Capability = {
  id: "delivery",
  version: 1,
  description: "Gate delivery intent with traceable user authorization and completion readiness while leaving Git, PR, publish and release execution to native OpenCode tools.",
  async setup({ ctx, state, observability }) {
    const registration = await ctx.tool.transform((editor: any) => {
      editor.namespace({ name: "andmar", description: "AndMar AI harness primitives" })
      editor.add({
        name: "delivery",
        description:
          "Authorize one named post-completion delivery operation (commit, push, pull-request, merge, tag, version, publish, release). Reads the current raw user message directly; callers cannot assert authorization. A non-completed Task Contract fails closed. With no Task Contract, only an explicit operational/trivial continuation may proceed, and OpenCode must inspect native repository state. This tool never executes Git, PR, publish or release actions.",
        input: {
          type: "object",
          properties: {
            operation: { type: "string", enum: [...OPERATIONS] },
          },
          required: ["operation"],
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (input: { operation: DeliveryOperation }, toolContext: unknown) => {
          const sessionID = sessionIDFrom(toolContext)
          if (!sessionID) return { content: "refused: cannot determine the current session ID" }

          let request: string | undefined
          try {
            const messages = await ctx.session.context({ sessionID })
            request = latestUserText(messages, messageIDFrom(toolContext))
          } catch {
            request = undefined
          }
          if (!request) {
            observability?.emit({
              type: "andmar.delivery",
              sessionID,
              payload: { action: "denied", operation: input.operation, reason: "raw_user_request_unavailable" },
            })
            return {
              content: JSON.stringify({
                allowed: false,
                operation: input.operation,
                authorization: { authorized: false, source: "current-user-request", reason: "raw-user-request-unavailable" },
                execution: "opencode-native",
              }, null, 2),
            }
          }

          const decision = await evaluateDelivery(state, sessionID, request, input.operation)
          observability?.emit({
            type: "andmar.delivery",
            sessionID,
            payload: {
              action: decision.allowed ? "authorized" : "denied",
              operation: decision.operation,
              authorizationReason: decision.authorization.reason,
              readinessSource: decision.readiness.source,
              contractStatus: decision.readiness.taskContract,
            },
          })
          return { content: JSON.stringify(decision, null, 2) }
        },
      })
    })

    return registration && typeof (registration as { dispose?: unknown }).dispose === "function"
      ? () => void (registration as { dispose: () => void }).dispose()
      : undefined
  },
}

export default deliveryCapability
