import type { Capability, CapabilityRuntime } from "./contracts.ts"

export async function setupCapabilities(
  runtime: CapabilityRuntime,
  capabilities: readonly Capability[],
): Promise<() => void> {
  const seen = new Set<string>()
  const cleanup: Array<() => void> = []

  for (const capability of capabilities) {
    if (seen.has(capability.id)) throw new Error(`Duplicate capability id: ${capability.id}`)
    seen.add(capability.id)
    // Preserve the original exception and authority. Expose unexpected owned
    // hook failures to local diagnostics without making subscribers a gate.
    const tool = runtime.ctx.tool
    const observedTool = { ...tool }
    observedTool.hook = (name: string, callback: (event: any) => unknown) => tool.hook(name, async (event: any) => {
      try { return await callback(event) }
      catch (error) {
        // Expected policy refusals are not infrastructure defects.
        if (!/^Error: AndMar (?:checkpoint required|recovery required):/.test(String(error))) {
          try { runtime.observability?.emit({ type: "andmar.runtime", sessionID: event.sessionID,
            payload: { action: "internal_failure", component: "hook", owner: capability.id,
              transition: name, category: `${capability.id}:hook-exception`, error: String(error) } }) } catch {}
        }
        throw error
      }
    })
    observedTool.transform = (callback: (editor: any) => unknown) => tool.transform((editor: any) => {
      const observedEditor = { ...editor }
      observedEditor.add = (definition: any) => editor.add({ ...definition, execute: async (input: any, context: any) => {
        try { return await definition.execute(input, context) }
        catch (error) {
          try { runtime.observability?.emit({ type: "andmar.runtime", sessionID: context?.sessionID,
            payload: { action: "internal_failure", component: capability.id,
              transition: definition.name, category: "tool-exception", error: String(error) } }) } catch {}
          throw error
        }
      } })
      return callback(observedEditor)
    })
    const ctx = { ...runtime.ctx, tool: observedTool }
    const dispose = await capability.setup({ ...runtime, ctx })
    if (dispose) cleanup.push(dispose)
  }

  return () => {
    for (const dispose of cleanup.reverse()) dispose()
  }
}
