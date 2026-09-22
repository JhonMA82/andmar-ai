import type { Capability, ModelProfile, TaskSignals, WorkerRecord } from "../../core/contracts.ts"
import { runChildTask } from "../../core/session.ts"
import { clampRequestedProfile, minimumProfile } from "../../core/model-policy.ts"

function currentSessionID(toolContext: any): string | undefined {
  return toolContext?.sessionID ?? toolContext?.session?.id ?? toolContext?.metadata?.sessionID
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n…[truncated by AndMar AI]`
}

function boundedChildResult(result: string | undefined, max: number): string {
  if (result === undefined) {
    return "(child session finished without a final text response; inspect the child session directly with andmar_resume)"
  }
  return truncate(result, max)
}

export const delegationCapability: Capability = {
  id: "delegation",
  version: 1,
  description: "Bounded child-session delegation with model-profile routing and durable handles.",
  async setup({ ctx, config, state, observability }) {
    const registration = await ctx.tool.transform((editor: any) => {
      editor.namespace({ name: "andmar", description: "AndMar AI harness primitives" })
      editor.add({
        name: "delegate",
        description: "Delegate a bounded task to an OpenCode child session. The child inherits parent permissions; delegation never raises authority.",
        input: {
          type: "object",
          properties: {
            task: { type: "string", minLength: 1 },
            title: { type: "string" },
            kind: {
              type: "string",
              enum: ["trivial-ui", "docs-format", "known-test", "feature", "bugfix", "refactor", "debug", "architecture", "security", "migration", "review", "internal"],
            },
            scopeFiles: { type: "integer", minimum: 0 },
            risk: { type: "string", enum: ["low", "medium", "high", "critical"] },
            uncertainty: { type: "string", enum: ["low", "medium", "high"] },
            reasoning: { type: "string", enum: ["low", "medium", "high"] },
            publicApi: { type: "boolean" },
            externalSideEffects: { type: "boolean" },
            verificationFailures: { type: "integer", minimum: 0 },
            requestedProfile: { type: "string", enum: ["fast", "standard", "frontier"] },
          },
          required: ["task", "kind"],
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (input: TaskSignals & { task: string; title?: string; requestedProfile?: ModelProfile }, toolContext: any) => {
          const parentSessionID = currentSessionID(toolContext)
          if (!parentSessionID) {
            return { content: "AndMar AI could not determine the current session ID from this OpenCode build; use a current V2 build or invoke delegation through a session-aware command adapter." }
          }

          const parentRecord = await state.get<WorkerRecord>(`worker-by-session/${parentSessionID}`)
          const depth = (parentRecord?.depth ?? 0) + 1
          if (depth > config.delegation.maxDepth) {
            observability?.emit({
              type: "andmar.delegation",
              sessionID: parentSessionID,
              payload: {
                operation: "delegate",
                phase: "denied",
                kind: input.kind,
                depth,
                maxDepth: config.delegation.maxDepth,
              },
            })
            return { content: `Delegation denied: maxDepth=${config.delegation.maxDepth}. Resolve this task directly.` }
          }

          const minimum = minimumProfile(input)
          const profile = clampRequestedProfile(input.requestedProfile, minimum)
          const model = config.models[profile]
          const parent = await ctx.session.get({ sessionID: parentSessionID })
          const selectedModel = model ?? parent.model

          const child = await ctx.session.create({
            parentID: parentSessionID,
            title: input.title ?? `AndMar: ${input.kind}`,
            ...(selectedModel ? { model: selectedModel } : {}),
            metadata: { andmar: { profile, depth, kind: input.kind } },
          })

          const startedAt = Date.now()
          const record: WorkerRecord = {
            sessionID: child.id,
            parentSessionID,
            profile,
            depth,
            status: "running",
            createdAt: startedAt,
            updatedAt: startedAt,
          }
          await state.set(`workers/${parentSessionID}/${child.id}`, record)
          await state.set(`worker-by-session/${child.id}`, record)
          observability?.emit({
            type: "andmar.delegation",
            sessionID: parentSessionID,
            payload: {
              operation: "delegate",
              phase: "started",
              childSessionID: child.id,
              kind: input.kind,
              profile,
              depth,
            },
          })

          try {
            const childText = await runChildTask(ctx.session, child.id, input.task)
            const finished = { ...record, status: "idle" as const, updatedAt: Date.now() }
            await state.set(`workers/${parentSessionID}/${child.id}`, finished)
            await state.set(`worker-by-session/${child.id}`, finished)
            observability?.emit({
              type: "andmar.delegation",
              sessionID: parentSessionID,
              payload: {
                operation: "delegate",
                phase: "completed",
                childSessionID: child.id,
                kind: input.kind,
                profile,
                depth,
                durationMs: finished.updatedAt - startedAt,
              },
            })
            return {
              content: JSON.stringify({
                sessionID: child.id,
                profile,
                result: boundedChildResult(childText, config.delegation.maxResultChars),
              }, null, 2),
            }
          } catch (error) {
            const failed = { ...record, status: "failed" as const, updatedAt: Date.now() }
            await state.set(`workers/${parentSessionID}/${child.id}`, failed)
            await state.set(`worker-by-session/${child.id}`, failed)
            observability?.emit({
              type: "andmar.delegation",
              sessionID: parentSessionID,
              payload: {
                operation: "delegate",
                phase: "failed",
                childSessionID: child.id,
                kind: input.kind,
                profile,
                depth,
                durationMs: failed.updatedAt - startedAt,
              },
            })
            throw error
          }
        },
      })

      editor.add({
        name: "resume",
        description: "Continue an AndMar child session using its persistent handle instead of rebuilding context.",
        input: {
          type: "object",
          properties: {
            sessionID: { type: "string", minLength: 1 },
            task: { type: "string", minLength: 1 },
          },
          required: ["sessionID", "task"],
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (input: { sessionID: string; task: string }, toolContext: any) => {
          const parentSessionID = currentSessionID(toolContext)
          if (!parentSessionID) return { content: "Cannot establish session ownership." }
          const record = await state.get<WorkerRecord>(`workers/${parentSessionID}/${input.sessionID}`)
          if (!record) return { content: "Resume denied: this session is not owned by the current parent session." }
          const startedAt = Date.now()
          try {
            const childText = await runChildTask(ctx.session, input.sessionID, input.task)
            observability?.emit({
              type: "andmar.delegation",
              sessionID: parentSessionID,
              payload: {
                operation: "resume",
                phase: "completed",
                childSessionID: input.sessionID,
                profile: record.profile,
                depth: record.depth,
                durationMs: Date.now() - startedAt,
              },
            })
            return {
              content: JSON.stringify({
                sessionID: input.sessionID,
                profile: record.profile,
                result: boundedChildResult(childText, config.delegation.maxResultChars),
              }, null, 2),
            }
          } catch (error) {
            observability?.emit({
              type: "andmar.delegation",
              sessionID: parentSessionID,
              payload: {
                operation: "resume",
                phase: "failed",
                childSessionID: input.sessionID,
                profile: record.profile,
                depth: record.depth,
                durationMs: Date.now() - startedAt,
              },
            })
            throw error
          }
        },
      })
    })
    return registration?.dispose ? () => void registration.dispose() : undefined
  },
}

export default delegationCapability
