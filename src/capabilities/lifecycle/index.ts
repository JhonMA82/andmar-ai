import type { Capability, ChangeKind, CompletionEvidence } from "../../core/contracts.ts"
import { analyzeDocumentationImpact, evaluateCompletion, inferVersionImpact } from "../../core/lifecycle.ts"
import { matchesAny } from "../../core/glob.ts"

export const lifecycleCapability: Capability = {
  id: "lifecycle",
  version: 1,
  description: "Deterministic documentation, versioning and completion gates.",
  async setup({ ctx, config }) {
    const registration = await ctx.tool.transform((editor: any) => {
      editor.namespace({ name: "andmar", description: "AndMar AI harness primitives" })
      editor.add({
        name: "change_impact",
        description: "Evaluate documentation and version impact from changed paths and an explicit change kind.",
        input: {
          type: "object",
          properties: {
            changedPaths: { type: "array", items: { type: "string" }, minItems: 1 },
            kind: {
              type: "string",
              enum: ["trivial-ui", "docs-format", "known-test", "feature", "bugfix", "refactor", "debug", "architecture", "security", "migration", "review", "internal"],
            },
            breaking: { type: "boolean" },
          },
          required: ["changedPaths", "kind"],
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (input: { changedPaths: string[]; kind: ChangeKind; breaking?: boolean }) => {
          const docs = analyzeDocumentationImpact(input.changedPaths, config.documentation.rules)
          const touchesPublicSurface = input.changedPaths.some((path) => matchesAny(config.versioning.publicPaths, path))
          const version = config.versioning.enabled
            ? inferVersionImpact({ kind: input.kind, touchesPublicSurface, ...(input.breaking === undefined ? {} : { breaking: input.breaking }) })
            : "none"
          return { content: JSON.stringify({ docs, version, touchesPublicSurface }, null, 2) }
        },
      })

      editor.add({
        name: "completion_gate",
        description: "Accept completion only when evidence belongs to the exact current revision and lifecycle gates are clean.",
        input: {
          type: "object",
          properties: {
            currentRevision: { type: "string", minLength: 1 },
            evidence: {
              type: "object",
              properties: {
                revision: { type: "string", minLength: 1 },
                testsPassed: { type: "boolean" },
                reviewPassed: { type: "boolean" },
                docsStatus: { type: "string", enum: ["clean", "updated", "stale", "not-applicable"] },
                versionStatus: { type: "string", enum: ["clean", "updated", "required", "not-applicable"] },
              },
              required: ["revision", "testsPassed", "docsStatus", "versionStatus"],
              additionalProperties: false,
            },
          },
          required: ["currentRevision", "evidence"],
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async (input: { currentRevision: string; evidence: CompletionEvidence }) => ({
          content: JSON.stringify(evaluateCompletion(input.currentRevision, input.evidence), null, 2),
        }),
      })
    })
    return registration?.dispose ? () => void registration.dispose() : undefined
  },
}

export default lifecycleCapability
