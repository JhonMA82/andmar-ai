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
    const dispose = await capability.setup(runtime)
    if (dispose) cleanup.push(dispose)
  }

  return () => {
    for (const dispose of cleanup.reverse()) dispose()
  }
}
