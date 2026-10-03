import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { realpath, stat } from "node:fs/promises"
import { resolve } from "node:path"
import type { Rpc } from "@opencode/plugin"
import type { CapabilityRuntime } from "../../core/contracts.ts"
import { normalizeFiles, runWorkUnitLifecycle, type Discovery, type LedgerResult } from "../../../scripts/work-ledger-lifecycle.mjs"

import { runWork, createLedgerReader, compactStatus } from "../../../scripts/andmar-work.mjs"

const ANDMAR_TOOL_PREFIX = /^andmar[_/:.-]/
const localToolName = (name: string) => name.replace(ANDMAR_TOOL_PREFIX, "")
const isNamespacedAndmarTool = (name: string) => ANDMAR_TOOL_PREFIX.test(name)
const EDIT_TOOLS = new Set(["write", "edit", "patch", "apply_patch"])
const SHELL_TOOLS = new Set(["shell", "bash"])
const CHECKPOINT_READ_TOOLS = new Set(["read", "search", "glob", "grep", "list", "question"])
const CHECKPOINT_CONTROL_TOOLS = new Set([
  "status", "intake", "route",
  "work_status", "work_context", "work", "work_resume", "task_contract",
])
const discoveryProperties = {
  title: { type: "string", minLength: 1, maxLength: 500 },
  reason: { type: "string", minLength: 1, maxLength: 500 },
  risk: { type: "string", enum: ["low", "medium", "high", "critical"] },
  withinGoal: { type: "boolean" }, materialScope: { type: "boolean" },
  humanDecision: { type: "boolean" }, hardToReverse: { type: "boolean" },
  contradictsContract: { type: "boolean" }, changesObligation: { type: "boolean" },
  expectedFiles: { type: "array", items: { type: "string", minLength: 1 } },
} as const

// Read-only presentation API. JSON Schema is already supported by the pinned
// plugin; no Zod, TUI framework or additional runtime dependency is required.
export const WorkRpc = {
  id: "andmar.work",
  methods: {
    get: {
      input: { type: "object", properties: { sessionID: { type: "string", minLength: 1 } }, required: ["sessionID"], additionalProperties: false },
      output: { type: ["object", "null"] },
    },
  },
  events: {
    changed: {
      schema: { type: "object", properties: { sessionID: { type: "string" }, workId: { type: "string" }, reason: { type: "string" } }, required: ["sessionID", "workId", "reason"], additionalProperties: false },
    },
  },
} as const satisfies Rpc.PortableDefinition

export function editedFiles(output: unknown): string[] {
  if (!output || typeof output !== "object") return []
  const data = output as Record<string, unknown>
  const files = typeof data.resource === "string" ? [data.resource] : []
  for (const [field, key] of [["files", "file"], ["applied", "resource"]] as const) {
    if (Array.isArray(data[field])) for (const item of data[field]) {
      if (item && typeof item === "object" && typeof item[key] === "string") files.push(item[key])
    }
  }
  return [...new Set(files)]
}

type UserMessage = { id: string; time?: { created: number | { epochMilliseconds: number } } }

// ctx.session.context returns DateTime.Utc; encoded clients expose millis.
// A blocked Work Unit always records `Checkpoint At`, so the temporal boundary
// is decidable without relying on message identity or ordering.
export function checkpointResponseAfter(ledger: Pick<LedgerResult, "checkpointAt">, messages: UserMessage[]): boolean {
  const latest = messages.at(-1)
  if (!latest || !ledger.checkpointAt) return false
  const created = latest.time?.created
  const millis = typeof created === "number" ? created : created?.epochMilliseconds
  return typeof millis === "number" && Number.isFinite(millis) && millis > ledger.checkpointAt
}

interface Binding {
  workId: string
  directory: string
  currentActivity: string | null
  lastVerification: Record<string, unknown> | null
  trackingError: string | null
  reader: ReturnType<typeof createLedgerReader>
  invalid?: boolean
  checkpoint?: { at: number | null; user: string | null }
  closed?: boolean
  lastValid?: { workUnit: string; status: string; next: string }
  lastTransition?: string
}

export function projectWork(ledger: LedgerResult, runtime?: Pick<Binding, "currentActivity" | "lastVerification" | "trackingError">) {
  const units = ledger.units ?? []
  const active = units.find((unit) => unit.id === ledger.active) ?? units.find((unit) => unit.state === "blocked")
  return {
    workId: ledger.workId, title: ledger.title, status: ledger.status,
    activeWorkUnit: active?.id ?? null,
    completedUnits: units.filter((unit) => unit.state === "done").length,
    totalUnits: units.length,
    currentActivity: runtime?.currentActivity ?? null,
    expectedFiles: active?.expectedFiles ?? [],
    touchedFiles: active?.touchedFiles ?? [],
    drift: active?.drift ?? [], scopeKnown: active?.scopeKnown ?? false,
    lastVerification: runtime?.lastVerification ?? null,
    blockedReason: ledger.blockedReason ?? null,
    checkpointRequired: ledger.checkpointRequired === true,
    trackingError: runtime?.trackingError ?? null,
    pending: units.filter((unit) => unit.state === "pending").map((unit) => unit.id),
    done: units.filter((unit) => unit.state === "done").map((unit) => unit.id),
    completionReady: ledger.completionReady === true,
  }
}

export async function setupWorkTracking({ ctx, observability }: CapabilityRuntime) {
  const workspace = ctx.location?.directory
  if (typeof workspace !== "string") return () => {}
  // Session -> repository mapping only. No Ledger mirror in ctx.storage.
  const bindings = new Map<string, Binding>()
  const calls = new Map<string, { binding: Binding; unit?: string; before: LedgerResult; activity: string; filesBefore?: Map<string, string> | undefined }>()
  const disposers: Array<() => void> = []
  let rpc: any
  const retainBoundary = (binding: Binding, result: LedgerResult) => {
    binding.lastValid = { workUnit: result.active ?? "", status: result.status ?? "unknown", next: result.completionReady ? "verify → completion → finalize" : "execute → verify → completion → finalize" }
  }
  const users = async (sessionID: string) => (await ctx.session.context({ sessionID })).filter((message: any) => message.type === "user")
  const notify = (sessionID: string, binding: Binding, reason: string) => {
    if (reason !== "work.activity" && reason !== "work.tracking.failed" && reason !== "checkpoint.required") binding.lastTransition = reason
    if (reason !== "work.activity" && !reason.startsWith("verification.")) {
      observability?.emit({ type: "andmar.work", sessionID, payload: { workId: binding.workId, action: reason, workUnit: binding.lastValid?.workUnit ?? "", next: binding.lastValid?.next ?? "validate → resume" } })
    }
    // Presentation transport is best-effort and never becomes a health gate.
    try { void Promise.resolve(rpc?.events.emit("changed", { sessionID, workId: binding.workId, reason })).catch(() => {}) } catch {}
  }
  const status = async (binding: Binding) => {
    try {
      const result = await binding.reader.get(binding.directory)
      if (binding.invalid && binding.checkpoint && (!result.checkpointRequired || result.checkpointAt !== binding.checkpoint.at || result.checkpointUser !== binding.checkpoint.user)) throw new Error("Recovery must restore the trusted checkpoint boundary; resolve it with work_resume afterward")
      if (result.checkpointRequired) binding.checkpoint = { at: result.checkpointAt ?? null, user: result.checkpointUser ?? null }
      else delete binding.checkpoint
      retainBoundary(binding, result)
      binding.invalid = false
      if (binding.trackingError?.startsWith("Ledger invalid:")) binding.trackingError = null
      return result
    } catch (error) {
      if (!binding.invalid) observability?.emit({ type: "andmar.runtime", sessionID: [...bindings].find(([, value]) => value === binding)?.[0], payload: {
        action: "internal_failure", component: "lifecycle", transition: "ledger.validate", category: "invalid-ledger", error: String(error), severe: true,
        workId: binding.workId, workUnit: binding.lastValid?.workUnit ?? "", lastSuccess: binding.lastTransition ?? "work.bind", expected: binding.lastValid?.next ?? "validate → resume",
      } })
      binding.invalid = true
      binding.trackingError = `Ledger invalid: ${String(error)}`
      throw error
    }
  }
  const projection = async (sessionID: string) => {
    const binding = bindings.get(sessionID)
    if (!binding) return null
    try { return projectWork(await status(binding), binding) }
    catch { return { workId: binding.workId, status: "invalid", recoveryRequired: true, diagnostic: binding.trackingError, completionReady: false } }
  }
  const bind = async (sessionID: string, workId: string) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(workId)) throw new Error("Invalid workId")
    const directory = resolve(workspace, ".andmar/work", workId)
    if (await realpath(directory) !== resolve(await realpath(workspace), ".andmar/work", workId)) throw new Error("Ledger path must not escape through symlinks")
    const prior = bindings.get(sessionID)
    if (prior && prior.workId !== workId && (!prior.invalid && (await status(prior)).status !== "completed" || prior.invalid)) throw new Error("Finish the current work before switching the session binding")
    const binding = prior?.workId === workId ? prior : { workId, directory, currentActivity: null, lastVerification: null, trackingError: null, reader: createLedgerReader() }
    bindings.set(sessionID, binding)
    const ledger = await status(binding)
    binding.closed = ledger.status === "completed"
    bindings.set(sessionID, binding)
    notify(sessionID, binding, ledger.status === "completed" ? "work.completed" : "work.started")
    return binding
  }

  const registration = await ctx.tool.transform((editor: any) => {
    editor.add({
      name: "work_status",
      description: "Bind an existing portable Work Ledger to this session, or read compact progress. Invalid Ledgers retain recovery access. No Ledger is created. Use only when Intake already selected Ledger-backed work; trivial edits skip this tool.",
      input: { type: "object", properties: { workId: { type: "string", minLength: 1 } }, additionalProperties: false },
      options: { namespace: "andmar", codemode: true },
      execute: async (input: { workId?: string }, context: any) => {
        try {
          if (input.workId) await bind(context.sessionID, input.workId)
          return { content: JSON.stringify(await projection(context.sessionID)) }
        } catch (error) { return { content: JSON.stringify({ workId: input.workId, status: "invalid", recoveryRequired: true, diagnostic: String(error), completionReady: false }) } }
      },
    })
    editor.add({
      name: "work_context",
      description: "Project active WU context or a specific requirement, constraint, evidence or source section. Full documents require an explicit document selector.",
      input: { type: "object", properties: Object.fromEntries(["unit", "requirement", "constraint", "evidence", "document", "section"].map(name => [name, { type: "string" }])), additionalProperties: false },
      options: { namespace: "andmar", codemode: true },
      execute: async (input: Record<string, any>, context: any) => {
        const binding = bindings.get(context.sessionID)
        if (!binding) return { content: "refused: bind work first" }
        try { return { content: JSON.stringify(await runWork("context", binding.directory, input)) } }
        catch (error) { return { content: JSON.stringify({ recoveryRequired: true, diagnostic: String(error) }) } }
      },
    })
    editor.add({
      name: "work",
      description: "Structured portable Ledger init, validate, record-evidence and WU activate/complete/block/reopen/touch. Uses deterministic serialization; never hand-author IDs. Human checkpoint resume uses work_resume. Finalize uses installed helper only after completion gate.",
      input: { type: "object", properties: {
        op: { type: "string", enum: ["init", "validate", "record-evidence", "activate", "complete", "block", "reopen", "touch"] },
        workId: { type: "string" }, payload: { type: "object" },
      }, required: ["op"], additionalProperties: false },
      options: { namespace: "andmar", codemode: true },
      execute: async (input: { op: string; workId?: string; payload?: Record<string, any> }, context: any) => {
        try {
          let binding = bindings.get(context.sessionID)
          if (input.op === "init") {
            if (binding && (await status(binding)).status !== "completed") throw new Error("Finish bound work before creating another Ledger")
            if (!input.workId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(input.workId)) throw new Error("Invalid workId")
            await runWork("init", resolve(workspace, ".andmar/work", input.workId), input.payload)
            binding = await bind(context.sessionID, input.workId)
            return { content: JSON.stringify(compactStatus(await status(binding))) }
          }
          if (!binding) throw new Error("Bind work first")
          if (input.workId && input.workId !== binding.workId) throw new Error("workId does not match binding")
          const ledger = input.op === "validate" ? null : await status(binding)
          if (ledger?.checkpointRequired) throw new Error("Resolve checkpoint through work_resume before mutations")
          const result = await runWork(input.op, binding.directory, input.payload)
          if (result.changed) binding.reader.invalidate()
          if (result.status) retainBoundary(binding, result)
          notify(context.sessionID, binding, `work.${input.op}`)
          return { content: JSON.stringify(result) }
        } catch (error) { return { content: JSON.stringify({ ok: false, recoveryRequired: true, diagnostic: String(error) }) } }
      },
    })
    editor.add({
      name: "work_amend",
      description: "Append necessary discovered work under the active WU's existing requirements. Explicit exception facts decide continue vs blocked checkpoint. Never changes Task Contract obligations. Requires a bound Ledger; normal tasks do not call this mechanically.",
      input: { type: "object", properties: discoveryProperties, required: Object.keys(discoveryProperties).filter((key) => key !== "expectedFiles"), additionalProperties: false },
      options: { namespace: "andmar", codemode: true },
      execute: async (input: Discovery, context: any) => {
        const binding = bindings.get(context.sessionID)
        if (!binding) return { content: "refused: bind an existing Ledger with work_status first" }
        try {
          const checkpointUser = (await users(context.sessionID)).at(-1)?.id
          const result = await runWorkUnitLifecycle("amend", binding.directory, undefined, { discovery: input, ...(checkpointUser ? { checkpointUser } : {}) })
          binding.reader.invalidate()
          retainBoundary(binding, result)
          notify(context.sessionID, binding, result.checkpointRequired ? "checkpoint.required" : "work.amended")
          return { content: JSON.stringify({ changed: result.changed, ...compactStatus(result), continue: result.continue, reasons: result.reasons, ...(result.unit ? { unit: result.unit } : {}) }) }
        } catch (error) { return { content: `refused: ${String(error)}` } }
      },
    })
    editor.add({
      name: "work_resume",
      description: "Resolve a blocked WU after the user's checkpoint response. Update durable requirements and Task Contract first if the decision changed obligations. Never clears an exception before a new user message.",
      input: { type: "object", properties: { reason: { type: "string", minLength: 1, maxLength: 500 } }, required: ["reason"], additionalProperties: false },
      options: { namespace: "andmar", codemode: true },
      execute: async (input: { reason: string }, context: any) => {
        const binding = bindings.get(context.sessionID)
        if (!binding) return { content: "refused: bind the blocked Ledger with work_status({workId}) first" }
        try {
          const ledger = await status(binding)
          const unit = ledger.units?.find((candidate) => candidate.state === "blocked")
          if (!unit) return { content: "refused: no blocked Work Unit" }
          const messages = await users(context.sessionID)
          const boundary = { user: ledger.checkpointUser ?? null, at: ledger.checkpointAt ?? null }
          if (!checkpointResponseAfter(ledger, messages)) {
            return { content: `refused: checkpoint is waiting for a user response created after ${boundary.at ? `checkpoint time ${boundary.at}` : `message ${boundary.user}`}; ask about the displayed blocker, then call work_resume with the decision` }
          }
          const result = await runWorkUnitLifecycle("resume", binding.directory, unit.id, { ...input, expectedCheckpoint: boundary })
          binding.reader.invalidate()
          retainBoundary(binding, result)
          notify(context.sessionID, binding, "work.resumed")
          return { content: JSON.stringify({ changed: result.changed, ...compactStatus(result), ...(result.unit ? { unit: result.unit } : {}) }) }
        } catch (error) { return { content: `refused: ${String(error)}` } }
      },
    })
  })
  if (registration?.dispose) disposers.push(() => void registration.dispose())

  const snapshot = async (): Promise<Map<string, string>> => {
    if (!ctx.vcs?.status) throw new Error("Native VCS status unavailable; shell touches require reconciliation")
    const output = await ctx.vcs.status({ location: { directory: workspace } })
    if (!Array.isArray(output?.data)) throw new Error("Native VCS status returned unsupported file data")
    const paths = normalizeFiles(output.data.map((item: any) => item.file), workspace).filter((file) => !/^\.andmar\/(?:work|learning|incidents)\//.test(file))
    if (paths.length > 500) throw new Error("Touch observation exceeded 500 dirty paths; reconcile scope through native VCS")
    const result = new Map<string, string>()
    let bytes = 0
    for (const file of paths) {
      const hash = createHash("sha256")
      try {
        bytes += (await stat(resolve(workspace, file))).size
        if (bytes > 16 * 1024 * 1024) throw new Error("Touch observation exceeded 16 MiB of dirty content; reconcile scope through native VCS")
        for await (const chunk of createReadStream(resolve(workspace, file))) hash.update(chunk)
        result.set(file, hash.digest("hex"))
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error
        result.set(file, "deleted")
      }
    }
    return result
  }

  const before = await ctx.tool.hook("execute.before", async (event: any) => {
    const binding = bindings.get(event.sessionID)
    if (!binding || binding.closed) return // fast path: no IO, no Ledger, no projection
    const rawTool = String(event.tool ?? "")
    const tool = localToolName(rawTool)
    let ledger: LedgerResult
    try { ledger = await status(binding) }
    catch {
      const paths = [event.input?.resource ?? event.input?.filePath ?? event.input?.path].filter((path): path is string => typeof path === "string")
      const repairCandidate = (tool === "write" || tool === "edit") && paths.length > 0 && paths.every(path => {
        const absolute = resolve(workspace, path)
        return ["WORK.md", "SOURCE.md", "REQUIREMENTS.md", "EVIDENCE.md"].some(name => absolute === resolve(binding.directory, name))
      })
      let repair = repairCandidate
      if (repair) for (const path of paths) {
        const absolute = resolve(workspace, path)
        try { if (await realpath(absolute) !== absolute) repair = false }
        catch (error: any) { if (error.code !== "ENOENT") repair = false }
      }
      const control = tool === "incident" || tool === "learning" && !["promote", "merge"].includes(event.input?.op) || tool === "work_status" || tool === "work_context" || tool === "work" && event.input?.op === "validate"
      if (CHECKPOINT_READ_TOOLS.has(tool) || repair || control || tool === "execute") return
      throw new Error(`AndMar recovery required: product mutations and completion refused; native read/search and Ledger-only repairs remain available. ${binding.trackingError}`)
    }
    if (ledger.status === "completed") { binding.closed = true; return }
    const checkpointControl = tool === "incident" || tool === "learning" && !["promote", "merge"].includes(event.input?.op) || CHECKPOINT_CONTROL_TOOLS.has(tool) && (tool !== "work" || event.input?.op === "validate")
    // Transport only; every native child re-enters with its own tool name.
    // V2.0.20 shares the outer call ID with those child hooks.
    if (tool === "execute") return
    if (ledger.checkpointRequired && !CHECKPOINT_READ_TOOLS.has(tool) && !checkpointControl) {
      // Fail closed only for a real exception, never for an unlisted file.
      notify(event.sessionID, binding, "checkpoint.required")
      throw new Error("AndMar checkpoint required: execution paused; inspect work_status and resolve the displayed blocker with work_resume after the user decision")
    }
    // OpenCode may expose AndMar tools to hooks either namespaced
    // (andmar.work_resume) or by their local registered name (work_resume).
    if (isNamespacedAndmarTool(rawTool) || checkpointControl) return
    let filesBefore: Map<string, string> | undefined
    if (ledger.active && SHELL_TOOLS.has(tool)) {
      try { filesBefore = await snapshot() } catch (error) { binding.trackingError = String(error) }
    }
    calls.set(event.id, { binding, ...(ledger.active ? { unit: ledger.active } : {}), before: ledger, activity: `Running ${event.tool}`, filesBefore })
    binding.currentActivity = `Running ${event.tool}` // no commands/output/prompts
    notify(event.sessionID, binding, "work.activity")
  })
  if (before?.dispose) disposers.push(() => void before.dispose())
  const after = await ctx.tool.hook("execute.after", async (event: any) => {
    if (localToolName(String(event.tool ?? "")) === "execute") return
    const call = calls.get(event.id)
    calls.delete(event.id)
    if (!call) return
    const { binding, unit, filesBefore } = call
    binding.currentActivity = [...calls.values()].filter((pending) => pending.binding === binding).at(-1)?.activity ?? null
    try {
      if (event.status === "completed" && unit && EDIT_TOOLS.has(event.tool)) {
        const files = editedFiles(event.result?.output)
        if (files.length) {
          await runWorkUnitLifecycle("touch", binding.directory, unit, { files })
          binding.reader.invalidate()
        } else {
          binding.trackingError = "Successful edit had no structured changed files; reconcile native VCS changes before completing the WU"
        }
      }
      // Shell tools have no structured edit output. Reuse native VCS status
      // and transient hashes of dirty files, never parse generated tool text.
      // Failed shells may have partial side effects: reconcile them too.
      if (unit && filesBefore && SHELL_TOOLS.has(event.tool)) {
        const filesAfter = await snapshot()
        const changed = [...new Set([...filesBefore.keys(), ...filesAfter.keys()])].filter((file) => filesBefore.get(file) !== filesAfter.get(file))
        if (changed.length) { await runWorkUnitLifecycle("touch", binding.directory, unit, { files: changed }); binding.reader.invalidate() }
      }
      const ledger = await status(binding)
      binding.closed = ledger.status === "completed"
      const drift = ledger.units?.find((candidate) => candidate.id === unit)?.drift ?? []
      const oldDrift = call.before.units?.find((candidate) => candidate.id === unit)?.drift ?? []
      if (JSON.stringify(drift) !== JSON.stringify(oldDrift)) notify(event.sessionID, binding, "work.drift")
      if (ledger.checkpointRequired) {
          notify(event.sessionID, binding, "checkpoint.required")
      } else if (ledger.status === "completed") notify(event.sessionID, binding, "work.completed")
      else if (ledger.active !== call.before.active) notify(event.sessionID, binding, "work.unit.started")
      if ((ledger.units?.filter((candidate) => candidate.state === "done").length ?? 0) > (call.before.units?.filter((candidate) => candidate.state === "done").length ?? 0)) notify(event.sessionID, binding, "work.unit.completed")
    } catch (error) {
      // Missing observational metadata must be visible but cannot turn an
      // already-successful native edit into a failure or encourage retries.
      binding.trackingError = String(error)
      notify(event.sessionID, binding, "work.tracking.failed")
    }
    notify(event.sessionID, binding, "work.activity")
  })
  if (after?.dispose) disposers.push(() => void after.dispose())

  const unsubscribe = observability?.subscribe((event) => {
    const binding = event.sessionID ? bindings.get(event.sessionID) : undefined
    if (!binding || event.type !== "andmar.verification") return
    const { action, ok, revision, check, passed } = event.payload
    if (action !== "verify_revision" && action !== "receipt") return
    binding.lastVerification = { action, ...(typeof ok === "boolean" ? { ok } : {}), ...(typeof revision === "string" ? { revision } : {}), ...(typeof check === "string" ? { check } : {}), ...(typeof passed === "boolean" ? { passed } : {}) }
    notify(event.sessionID!, binding, "verification.completed")
  })
  if (unsubscribe) disposers.push(unsubscribe)
  try {
    if (ctx.rpc?.register) {
      rpc = await ctx.rpc.register(WorkRpc, { get: async (input: any) => projection(input.sessionID) })
      if (rpc?.dispose) disposers.push(() => void rpc.dispose())
    }
  } catch { /* optional presentation transport */ }
  return () => { disposers.reverse().forEach((dispose) => dispose()); bindings.clear(); calls.clear() }
}
