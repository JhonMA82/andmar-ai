import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { assert, stableJson, validateResult, type Result } from "./schema.ts"

/** Explicit human ground truth, never a semantic parser or LLM judge. */
export function annotate(input: Result, claim: boolean, by: string, note: string): Result & { humanAssessment: { by: string; note: string; completionClaim: boolean; source: "human" } } {
  validateResult(input)
  assert(by.trim() && note.trim(), "Human assessment requires assessor and evidence note")
  return {
    ...input,
    quality: { ...input.quality, completionClaim: claim, falseCompletion: claim && !input.quality.taskSuccess },
    humanAssessment: { by, note, completionClaim: claim, source: "human" },
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    const option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
    const source = option("--result"), output = option("--output"), claim = option("--completion-claim"), by = option("--by"), note = option("--note")
    assert(source && output && by && note && ["true", "false"].includes(claim ?? ""), "Usage: bun bench/annotate.ts --result FILE --output FILE.result.json --completion-claim true|false --by NAME --note EVIDENCE")
    assert(resolve(source) !== resolve(output), "Preserve the original result; write an annotated copy in a separate cohort")
    const result = annotate(validateResult(JSON.parse(await readFile(source, "utf8"))), claim === "true", by, note)
    validateResult(result)
    await writeFile(output, stableJson(result), { mode: 0o600, flag: "wx" })
  } catch (e) { console.error((e as Error).message); process.exitCode = 1 }
}
