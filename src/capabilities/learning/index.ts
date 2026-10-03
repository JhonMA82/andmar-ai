import { randomUUID } from "node:crypto"
import type { Capability } from "../../core/contracts.ts"
import type { SemanticEventInput } from "../../core/observability.ts"
import { HARNESS_VERSION } from "../../generated/version.ts"
import { Capture } from "./capture.ts"
import { ProjectLearning, type LessonKind } from "./project-learning.ts"
import { RuntimeIncidents, type IncidentInput, type Outcome } from "./runtime-incidents.ts"
import { LIMITS, clean } from "./safety.ts"

export const learningCapability: Capability = {
  id: "learning",
  version: 1,
  description: "Bounded project lesson candidates and separate non-blocking AndMar runtime incident records.",
  async setup({ ctx, observability }) {
    const root = ctx.location?.directory
    if (typeof root !== "string") return
    const disposers: Array<() => void> = []
    const notices: string[] = []
    const notice = (message: string) => {
      notices.push(clean(message, LIMITS.evidenceChars)); if (notices.length > 16) notices.shift()
      // Host stderr is the available native diagnostic channel in plugin 2.0.4.
      // Explicit tools also return notices and use native progress; no prompt transform.
      console.warn(message)
    }
    let warned = false
    const warn = () => { if (!warned) { warned = true; notice("AndMar: learning/incident recording unavailable; task execution continues. Inspect storage permissions, corruption or stale .write-lock.") } }
    const learning = new ProjectLearning(root, notice)
    const incidents = new RuntimeIncidents(root, { andmar: HARNESS_VERSION, opencode: ctx.app?.version ?? "unknown" }, notice)
    const capture = new Capture()
    // Ownership identity is intentionally opaque, not a normalized incident signature.
    const owner = randomUUID().replaceAll("-", "").slice(0, 20)
    const works = new Map<string, { workId: string; workUnit: string; lastSuccess: string; expected: string }>()
    let queue = Promise.resolve()
    let queued = 0
    const enqueue = (action: () => Promise<unknown>) => {
      if (queued >= LIMITS.observations) { warn(); return }
      queued++
      queue = queue.then(action).then(() => {}, warn).finally(() => { queued-- })
    }
    const unsubscribe = observability?.subscribe((event: SemanticEventInput) => {
      if (!event.sessionID) return
      const p = event.payload
      const sessionID = event.sessionID
      if (event.type === "andmar.work" && typeof p.workId === "string") {
        const work = { workId: p.workId, workUnit: String(p.workUnit ?? ""), lastSuccess: String(p.action ?? "work.started"), expected: String(p.next ?? "execute → verify → completion → finalize") }
        works.delete(sessionID); works.set(sessionID, work)
        while (works.size > LIMITS.sessions) works.delete(works.keys().next().value!)
        if (p.action !== "work.tracking.failed" && p.action !== "checkpoint.required") enqueue(async () => {
          const result = await incidents.transition({ ...work, action: work.lastSuccess, next: work.expected }, owner)
          if (result.interrupted) notice(`AndMar: runtime incident ${result.interrupted.id} recorded — unfinished work resumed; previous cause unknown.`)
        })
        if (p.action === "work.completed") capture.clear(sessionID)
      }
      const work = works.get(sessionID)
      const isInternal = event.type === "andmar.runtime" && p.action === "internal_failure"
      // A missing receipt alone is normal "not verified yet". A passed receipt
      // whose backing execution has vanished is an explicit owning-component signal.
      if (isInternal) enqueue(() => incidents.recordIncident({
        flow: work || p.workId ? "work.execute" : "tool.execute", ...(work ? { workId: work.workId, workUnit: work.workUnit } : typeof p.workId === "string" ? { workId: p.workId, workUnit: String(p.workUnit ?? "") } : {}),
        expected: String(p.expected ?? work?.expected ?? "internal operation → valid result"), lastSuccess: String(p.lastSuccess ?? work?.lastSuccess ?? "unknown"),
        failedAt: String(p.transition ?? "unknown"), component: String(p.component ?? "unknown"),
        category: String(p.category ?? "internal-error"), error: String(p.error ?? "Internal component failed"), recoverable: true,
        severe: p.severe === true,
      }))
      if (event.type === "andmar.verification" && p.action === "verify_revision" && p.ok === true && work) enqueue(() => incidents.transition({ ...work, action: "verify", next: "completion → finalize" }, owner))
      if (event.type === "andmar.completion" && p.finalCompletion === true && work) enqueue(() => incidents.transition({ ...work, action: "completion", next: "finalize" }, owner))
    })
    if (unsubscribe) disposers.push(unsubscribe)
    const hook = await ctx.tool.hook("execute.after", async (event: any) => {
      try {
        const candidate = capture.observe(event)
        if (candidate) enqueue(async () => {
          const lesson = await learning.candidate(candidate)
          if (lesson?.status === "pending") notice(`AndMar: reusable lesson candidate ${lesson.id} captured.`)
        })
      } catch { warn() }
    })
    if (hook?.dispose) disposers.push(() => void hook.dispose())
    const registration = await ctx.tool.transform((editor: any) => {
      editor.namespace({ name: "andmar", description: "AndMar AI harness primitives" })
      editor.add({
        name: "learning",
        description: "Project Learning: pending/status, explicit validated foreground note, promote/merge into ordinary native skills, or drop. No background models. Never submit raw output, quotations or hypotheses. Promotion requires your own validated procedure and evidence.",
        input: { type: "object", properties: {
          op: { type: "string", enum: ["status", "pending", "note", "promote", "merge", "drop"] },
          id: { type: "string" }, mergeInto: { type: "string" }, name: { type: "string" }, description: { type: "string", maxLength: 300 },
          procedure: { type: "string", maxLength: LIMITS.skillChars }, reason: { type: "string", maxLength: LIMITS.summaryChars },
          kind: { type: "string", enum: ["USER_CORRECTION", "TECHNIQUE", "SKILL_WRONG"] },
          problem: { type: "string", maxLength: LIMITS.observationChars }, solution: { type: "string", maxLength: LIMITS.observationChars },
          evidence: { type: "string", maxLength: LIMITS.evidenceChars }, validated: { type: "boolean" }, source: { type: "string", enum: ["foreground-validated"] },
        }, required: ["op"], additionalProperties: false },
        options: { namespace: "andmar", codemode: true },
        execute: async (input: any, context: any) => {
          await queue
          try {
            let result: unknown
            if (input.op === "status" || input.op === "pending") result = { pending: await learning.pending(), notices: notices.splice(0), limits: LIMITS }
            else if (input.op === "drop") result = await learning.drop(input.id, input.reason)
            else if (input.op === "note") {
              if (!input.validated || input.source !== "foreground-validated" || !["USER_CORRECTION", "TECHNIQUE", "SKILL_WRONG"].includes(input.kind)) throw new Error("Note requires explicit foreground validation and evidence")
              result = await learning.candidate({ kind: input.kind as LessonKind, problem: input.problem, solution: input.solution, evidence: input.evidence, source: input.source })
            } else {
              if (input.op === "merge" && !input.mergeInto) throw new Error("Merge requires an explicit owned target")
              result = await learning.promote(input)
              // Refresh the normal host scanner; never maintain a private catalog.
              if (ctx.skill?.reload) {
                // Host reload may reconcile the active tool generation; awaiting
                // it inside that very tool can deadlock. Fire once, fail open.
                try { void Promise.resolve(ctx.skill.reload()).catch(() => notice("AndMar: skill written; native discovery refresh failed, retry native skill reload.")) } catch { notice("AndMar: skill written; native discovery refresh unavailable.") }
              }
            }
            if (context?.progress) await context.progress({ title: "AndMar: Project Learning decision recorded" }).catch(() => {})
            return { content: JSON.stringify(result) }
          } catch (error) { return { content: JSON.stringify({ ok: false, nonBlocking: true, diagnostic: clean(error) }) } }
        },
      })
      editor.add({
        name: "incident",
        description: "Runtime Incidents only: status/list, record explicit AndMar internal boundary failure, resolve original incident with recovery evidence, or explain cancellation/external/project failure for observed work. Diagnostic only; never modifies or gates Ledger, receipts or completion. Never report ordinary project stderr as an AndMar incident.",
        input: { type: "object", properties: {
          op: { type: "string", enum: ["status", "list", "record", "resolve", "outcome"] }, id: { type: "string" },
          incident: { type: "object", properties: {
            ...Object.fromEntries(["flow", "workId", "workUnit", "expected", "lastSuccess", "failedAt", "error", "evidence"].map(x => [x, { type: "string", maxLength: LIMITS.evidenceChars }])),
            component: { type: "string", enum: ["hook", "lifecycle", "verification", "task-contract", "completion", "checkpoint"] },
            category: { type: "string", maxLength: 100 }, recoverable: { type: "boolean" }, severe: { type: "boolean" }, manualIntervention: { type: "boolean" },
          }, required: ["flow", "expected", "lastSuccess", "failedAt", "component", "category", "error", "recoverable"], additionalProperties: false },
          recovery: { type: "string", maxLength: LIMITS.summaryChars }, evidence: { type: "string", maxLength: LIMITS.evidenceChars },
          workId: { type: "string" }, outcome: { type: "string", enum: ["cancelled-by-user", "blocked-external", "failed-project", "failed-andmar"] },
          explanation: { type: "string", maxLength: LIMITS.summaryChars },
        }, required: ["op"], additionalProperties: false },
        options: { namespace: "andmar", codemode: true },
        execute: async (input: any, context: any) => {
          await queue
          try {
            let result: unknown
            if (input.op === "resolve") result = await incidents.resolve(input.id, input.recovery, input.evidence)
            else if (input.op === "outcome") result = await incidents.outcome(input.workId, input.outcome as Outcome, input.explanation)
            else if (input.op === "record") result = await incidents.recordIncident(input.incident as IncidentInput)
            else result = { ...await incidents.list(), notices: notices.splice(0) }
            if (context?.progress) await context.progress({ title: "AndMar: Runtime Incident record updated" }).catch(() => {})
            return { content: JSON.stringify(result) }
          } catch (error) { warn(); return { content: JSON.stringify({ ok: false, nonBlocking: true, diagnostic: clean(error) }) } }
        },
      })
    })
    if (registration?.dispose) disposers.push(() => void registration.dispose())
    return () => { disposers.reverse().forEach(dispose => dispose()); capture.sessions.clear(); works.clear() }
  },
}
export default learningCapability
