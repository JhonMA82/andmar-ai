import { record } from "./schema.ts"

/** Optional read-only reuse of existing V2 plugin state, never usage accounting.
 * The internal kv encoding was inspected on OpenCode 2.0.20. A changed schema
 * returns unknown; it cannot prove harness activation or completion.
 */
export async function readHarnessState(database: string): Promise<{ lastStart: Record<string, unknown> | null; aggregate: unknown; warning: string | null }> {
  let db: import("node:sqlite").DatabaseSync | undefined
  try {
    const { DatabaseSync } = await import("node:sqlite")
    db = new DatabaseSync(database, { readOnly: true })
    const prefix = "plugin:" + [..."andmar.ai"].map(c => c.charCodeAt(0).toString(16).padStart(4, "0")).join("") + ":"
    const query = db.prepare("SELECT value FROM kv WHERE key = ?")
    const read = (key: string): unknown => {
      const row = query.get(prefix + key)
      return row && typeof row.value === "string" ? JSON.parse(row.value) : null
    }
    const start = read("runtime/last-start")
    return { lastStart: record(start) ? start : null, aggregate: read("development-metrics/v1/aggregate"), warning: null }
  } catch { return { lastStart: null, aggregate: null, warning: "Existing plugin state unavailable (OpenCode kv schema/Node SQLite unsupported); no activation proof" } }
  finally { db?.close() }
}
