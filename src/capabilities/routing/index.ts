import type { Capability, ModelProfile, TaskSignals } from "../../core/contracts.ts"
import { clampRequestedProfile, minimumProfile } from "../../core/model-policy.ts"

function currentSessionID(toolContext: any): string | undefined {
  return toolContext?.sessionID ?? toolContext?.session?.id ?? toolContext?.metadata?.sessionID
}

export const routingCapability: Capability = {
  id: "routing",
  version: 1,
  description: "Deterministic minimum-sufficient model profile selection.",
  async setup({ ctx, config, observability }) {
    const registration = await ctx.tool.transform((editor: any) => {
      editor.namespace({ name: "andmar", description: "AndMar AI harness primitives" })
      editor.add({
        name: "route",
        description: "Choose the minimum sufficient model profile for a task using deterministic rules.",
        input: {
          type: "object",
          properties: {
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
          required: ["kind"],
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (
          input: TaskSignals & { requestedProfile?: ModelProfile },
          toolContext: any,
        ) => {
          const minimum = minimumProfile(input)
          const profile = clampRequestedProfile(input.requestedProfile, minimum)
          const model = config.models[profile] ?? null

          observability?.emit({
            type: "andmar.routing",
            sessionID: currentSessionID(toolContext),
            payload: {
              kind: input.kind,
              minimum,
              profile,
              requestedProfile: input.requestedProfile ?? null,
              risk: input.risk ?? "low",
              uncertainty: input.uncertainty ?? "low",
              reasoning: input.reasoning ?? "low",
              scopeFiles: input.scopeFiles ?? null,
              publicApi: input.publicApi ?? false,
              externalSideEffects: input.externalSideEffects ?? false,
              verificationFailures: input.verificationFailures ?? 0,
            },
          })

          return {
            content: JSON.stringify({ profile, minimum, model: model ?? "inherit-session-model" }),
          }
        },
      })
    })
    return registration?.dispose ? () => void registration.dispose() : undefined
  },
}

export default routingCapability
