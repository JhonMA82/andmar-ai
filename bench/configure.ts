import { createInterface } from "node:readline/promises"
import { Writable } from "node:stream"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { assert } from "./schema.ts"
import { modelRef, validateCommonConfig } from "./runner.ts"
import { loadSettings, saveSettings, settingsFile } from "./settings.ts"

export async function configure(): Promise<void> {
  assert(process.stdin.isTTY, "Run bun run bench:configure in an interactive terminal")
  const previous = await loadSettings()
  let muted = false
  const output = new Writable({ write(chunk, _encoding, done) { if (!muted) process.stderr.write(chunk); done() } })
  const input = createInterface({ input: process.stdin, output, terminal: true })
  try {
    console.error("Benchmark setup: no model calls. Local settings are ignored by Git.")
    const model = (await input.question(`Exact provider/model#variant${previous ? ` [${previous.model}]` : ""}: `)).trim() || previous?.model || ""
    const ref = modelRef(model)
    console.error("API key (hidden; saved locally with permissions 0600). Enter keeps existing settings or uses provider environment.")
    muted = true
    const key = (await input.question("")).trim()
    muted = false
    console.error("")
    const sameProvider = previous && modelRef(previous.model).providerID === ref.providerID
    const commonConfig = sameProvider ? validateCommonConfig(previous.commonConfig) : {}
    // OpenRouter's normal variable is intentionally removed by the strict runner
    // to keep JEV on its deterministic fallback. Capture it only during setup.
    const apiKey = key || (!commonConfig.provider && ref.providerID === "openrouter" ? process.env.OPENROUTER_API_KEY : undefined)
    if (apiKey) {
      const providers = commonConfig.provider as Record<string, any> | undefined
      const provider = providers?.[ref.providerID] ?? {}
      commonConfig.provider = { ...providers, [ref.providerID]: { ...provider, settings: { ...provider.settings, apiKey } } }
    }
    if (ref.providerID === "openrouter") {
      const providers = commonConfig.provider as Record<string, any> | undefined
      assert(providers?.openrouter?.settings?.apiKey, "OpenRouter needs an API key here or OPENROUTER_API_KEY during setup; the runner does not inherit stored login credentials")
    }
    await saveSettings({ schemaVersion: 1, model, commonConfig })
    console.error(`Saved ${settingsFile}. Run: bun run bench --execute`)
    console.error("Runs use an isolated OpenCode database; stored OAuth/subscription logins are not inherited.")
  } finally { muted = false; input.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  configure().catch(e => { console.error((e as Error).message); process.exitCode = 1 })
}
