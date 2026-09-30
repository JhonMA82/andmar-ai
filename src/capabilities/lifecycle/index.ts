import type { Capability, ChangeKind } from "../../core/contracts.ts"
import { analyzeDocumentationImpact, inferVersionImpact } from "../../core/lifecycle.ts"
import { setupWorkTracking } from "./work.ts"
import { matchesAny } from "../../core/glob.ts"

export const lifecycleCapability: Capability = {
  id: "lifecycle",
  version: 4,
  description: "Deterministic documentation/version impact and portable Work Unit tracking.",
  async setup(runtime) {
    const { ctx, config } = runtime
    const disposeWork = await setupWorkTracking(runtime)
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
    })
    return () => { disposeWork(); if (registration?.dispose) void registration.dispose() }
  },
}

export default lifecycleCapability
