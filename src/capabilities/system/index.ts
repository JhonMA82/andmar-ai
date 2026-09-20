import type { Capability } from "../../core/contracts.ts"
import { HARNESS_VERSION } from "../../generated/version.ts"

export const systemCapability: Capability = {
  id: "system",
  version: 1,
  description: "Core safety rails, status and lightweight execution journaling.",
  async setup({ ctx, config, state }) {
    const disposers: Array<() => void> = []

    const toolRegistration = await ctx.tool.transform((editor: any) => {
      editor.namespace({ name: "andmar", description: "AndMar AI harness primitives" })
      editor.add({
        name: "status",
        description: "Read the active AndMar AI configuration and durable worker state.",
        input: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        options: { namespace: "andmar", codemode: true },
        execute: async () => {
          const workers = await state.scan("workers/")
          return {
            content: JSON.stringify({
              harness: "AndMar AI",
              version: HARNESS_VERSION,
              opencode: ctx.app?.version,
              workers: workers.map((entry) => entry.value),
              modelProfiles: Object.fromEntries(
                Object.entries(config.models).map(([key, value]) => [key, value ?? "inherit"]),
              ),
            }, null, 2),
          }
        },
      })
    })
    if (toolRegistration?.dispose) disposers.push(() => void toolRegistration.dispose())

    const shellHook = await ctx.shell.hook("create.before", (event: any) => {
      event.timeout = Math.min(event.timeout, config.shell.maxTimeoutMs)
    })
    if (shellHook?.dispose) disposers.push(() => void shellHook.dispose())

    const afterHook = await ctx.tool.hook("execute.after", async (event: any) => {
      const key = `journal/${event.sessionID ?? "unknown"}/${event.callID ?? `${Date.now()}-${event.tool ?? "tool"}`}`
      await state.set(key, {
        tool: event.tool,
        status: event.status,
        sessionID: event.sessionID,
        at: Date.now(),
      })
    })
    if (afterHook?.dispose) disposers.push(() => void afterHook.dispose())

    return () => disposers.reverse().forEach((dispose) => dispose())
  },
}

export default systemCapability
