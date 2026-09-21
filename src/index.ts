import { Plugin } from "@opencode/plugin"
import { setupCapabilities } from "./core/capability.ts"
import { resolveConfig } from "./core/config.ts"
import { createStateStore } from "./core/state.ts"
import { capabilities } from "./generated/capabilities.ts"
import { HARNESS_VERSION } from "./generated/version.ts"
import { createSemanticObservability } from "./core/observability.ts"

export default Plugin.define({
  id: "andmar.ai",
  async setup(ctx) {
    const config = resolveConfig(ctx.options)
    const state = createStateStore(ctx.storage)
    const observability = createSemanticObservability(ctx.location)
    await state.set("runtime/last-start", {
      at: Date.now(),
      opencodeVersion: ctx.app?.version,
      project: ctx.location?.project?.id,
      harnessVersion: HARNESS_VERSION,
    })

    return setupCapabilities({ ctx, config, state, observability }, capabilities)
  },
})
