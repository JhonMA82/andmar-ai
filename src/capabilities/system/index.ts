import type { Capability } from "../../core/contracts.ts"
import { HARNESS_VERSION } from "../../generated/version.ts"
import { ENGRAM_STATUS_KEY, type EngramIntegrationStatus } from "../../integrations/engram/index.ts"

export const systemCapability: Capability = {
  id: "system",
  version: 1,
  description: "Core safety rails, status and lightweight execution journaling.",
  async setup({ ctx, config, state, observability }) {
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
          const engram = await state.get<EngramIntegrationStatus>(ENGRAM_STATUS_KEY)
          return {
            content: JSON.stringify({
              harness: "AndMar AI",
              version: HARNESS_VERSION,
              opencode: ctx.app?.version,
              workers: workers.map((entry) => entry.value),
              modelProfiles: Object.fromEntries(
                Object.entries(config.models).map(([key, value]) => [key, value ?? "inherit"]),
              ),
              delivery: {
                workUnitCommits: config.delivery.workUnitCommits,
              },
              developmentMetrics: {
                enabled: config.developmentMetrics.enabled,
              },
              integrations: {
                engram: engram ?? {
                  provider: "engram",
                  mode: "advisory",
                  installed: false,
                  configured: false,
                  enabled: false,
                  available: false,
                  availabilityBasis: "unavailable",
                  runtimeObserved: false,
                },
              },
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
      // `event.id` is the stable Tool.CallID on this hook.
      const callID = typeof event.id === "string" && event.id !== "" ? event.id : undefined
      const key = `journal/${event.sessionID ?? "unknown"}/${callID ?? `${Date.now()}-${event.tool ?? "tool"}`}`
      await state.set(key, {
        tool: event.tool,
        status: event.status,
        sessionID: event.sessionID,
        ...(typeof callID === "string" ? { callID } : {}),
        at: Date.now(),
      })
      if (
        typeof event.tool === "string" &&
        event.tool.startsWith("andmar_") &&
        event.status !== "completed"
      ) {
        observability?.emit({
          type: "andmar.runtime",
          sessionID: event.sessionID,
          payload: { action: "capability_error", tool: event.tool, status: event.status ?? "unknown" },
        })
      }
    })
    if (afterHook?.dispose) disposers.push(() => void afterHook.dispose())

    return () => disposers.reverse().forEach((dispose) => dispose())
  },
}

export default systemCapability
