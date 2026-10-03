import { createHash } from "node:crypto"
import { LIMITS, clean, lessonText } from "./safety.ts"
import type { LessonInput } from "./project-learning.ts"

interface Observation { key: string; tool: string; command: string; failed: boolean; recovery: string; exit: number | null }

/** Only structured native outcomes; never inspect tool output or transcripts. */
export class Capture {
  readonly sessions = new Map<string, Observation[]>()
  observe(event: any): LessonInput | undefined {
    const session = event.sessionID
    const tool = String(event.tool ?? "")
    if (typeof session !== "string" || /^andmar[_/:.-]/.test(tool) || tool === "execute") return
    const items = this.sessions.get(session) ?? []
    this.sessions.delete(session); this.sessions.set(session, items)
    while (this.sessions.size > LIMITS.sessions) this.sessions.delete(this.sessions.keys().next().value!)
    const metadata = event.result?.metadata
    if (["edit", "write", "patch", "apply_patch"].includes(tool) && event.status === "completed") {
      for (const item of items) if (item.failed) item.recovery = `native ${tool}`
      return
    }
    if (!["shell", "bash"].includes(tool)) return
    const raw = typeof event.input === "string" ? event.input : event.input?.command
    if (typeof raw !== "string" || raw.length > LIMITS.observationChars) return
    // Secret-bearing/path-specific commands are deliberately rejected rather than
    // normalized into ambiguous pairs. No raw command reaches durable state.
    const command = clean(raw, LIMITS.observationChars)
    if (command !== raw.trim()) return
    try { lessonText(command, LIMITS.observationChars) } catch { return }
    const exit = metadata?.exit
    const success = event.status === "completed" && exit === 0 && !metadata?.signal && metadata?.timeout !== true
    // A hook/policy refusal is also a tool "error", but isn't a project
    // execution failure. Pair only observed native process failure outcomes.
    const failed = typeof exit === "number" && exit !== 0 || metadata?.signal || metadata?.timeout === true
    // Unlike an incident signature, command versions/numbers/quoted spaces
    // are semantic: never pair different invocations by redacting them.
    const key = createHash("sha256").update(`${tool}|${command}`).digest("hex")
    const prior = [...items].reverse().find(item => item.key === key && item.failed)
    if (success && prior?.recovery) {
      prior.failed = false
      return { kind: "RECOVERED_FAILURE", source: "observed-pair",
        problem: `${tool} command '${command}' failed${prior.exit === null ? "" : ` (exit ${prior.exit})`}`,
        solution: `After ${prior.recovery}, the same command succeeded. Foreground must distill the reusable procedure before promotion.`,
        evidence: `Observed execute.after failure → ${prior.recovery} → same-command exit 0` }
    }
    if (failed) {
      items.push({ key, tool, command, failed: true, recovery: "", exit: typeof exit === "number" ? exit : null })
      if (items.length > LIMITS.observations) items.splice(0, items.length - LIMITS.observations)
    }
  }
  clear(session: string) { this.sessions.delete(session) }
}
