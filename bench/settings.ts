import { readFile, writeFile, rename, rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { assert, record, stableJson } from "./schema.ts"

export const settingsFile = "bench/local.json"
export interface Settings {
  schemaVersion: 1
  model: string
  commonConfig: Record<string, unknown>
}
export function validateSettings(value: unknown): Settings {
  assert(record(value) && value.schemaVersion === 1, "Unsupported benchmark settings schema")
  assert(typeof value.model === "string" && /^[^/#]+\/[^#]+(?:#[^#]+)?$/.test(value.model), "Benchmark settings need exact provider/model#variant")
  assert(record(value.commonConfig), "Benchmark settings need a commonConfig object")
  return value as unknown as Settings
}
export async function loadSettings(file = settingsFile): Promise<Settings | null> {
  let contents: string
  try { contents = await readFile(file, "utf8") }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e }
  return validateSettings(JSON.parse(contents))
}
export async function saveSettings(settings: Settings, file = settingsFile): Promise<void> {
  validateSettings(settings)
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, stableJson(settings), { mode: 0o600, flag: "wx" })
    await rename(temporary, file)
  } finally { await rm(temporary, { force: true }) }
}
