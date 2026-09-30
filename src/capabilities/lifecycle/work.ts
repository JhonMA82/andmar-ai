import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { realpath, stat } from "node:fs/promises"
import { resolve } from "node:path"
import type { Rpc } from "@opencode/plugin"
import type { CapabilityRuntime } from "../../core/contracts.ts"
import { normalizeFiles, runWorkUnitLifecycle, type Discovery, type LedgerResult } from "../../../scripts/work-ledger-lifecycle.mjs"

const toolName = (name: string) => name.replace(/^andmar[_/:.-]/, "andmar_")
const EDIT_TOOLS = new Set(["write", "edit", "patch", "apply_patch"])
const SHELL_TOOLS = new Set(["shell", "bash"])
const READ_TOOLS = new Set(["read", "glob", "grep", "list", "question"])
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

interface Binding {
  workId: string
  directory: string
  currentActivity: string | null
  lastVerification: Record<string, unknown> | null
  trackingError: string | null
  closed?: boolean
  checkpointUserID?: string | undefined
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
    units,
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
  const latestUserID = async (sessionID: string): Promise<string | undefined> => {
    const messages = await ctx.session.context({ sessionID })
    return messages.filter((message: any) => message.type === "user").at(-1)?.id
  }
  const notify = (sessionID: string, binding: Binding, reason: string) => {
    if (reason !== "work.activity" && !reason.startsWith("verification.")) {
      observability?.emit({ type: "andmar.work", sessionID, payload: { workId: binding.workId, action: reason } })
    }
    // Presentation transport is best-effort and never becomes a health gate.
    try { void Promise.resolve(rpc?.events.emit("changed", { sessionID, workId: binding.workId, reason })).catch(() => {}) } catch {}
  }
  const status = (binding: Binding) => runWorkUnitLifecycle("status", binding.directory)
  const projection = async (sessionID: string) => {
    const binding = bindings.get(sessionID)
    return binding ? projectWork(await status(binding), binding) : null
  }
  const bind = async (sessionID: string, workId: string) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(workId)) throw new Error("Invalid workId")
    const directory = resolve(workspace, ".andmar/work", workId)
    if (await realpath(directory) !== resolve(await realpath(workspace), ".andmar/work", workId)) throw new Error("Ledger path must not escape through symlinks")
    const prior = bindings.get(sessionID)
    if (prior && prior.workId !== workId && (await status(prior)).status !== "completed") throw new Error("Finish the current work before switching the session binding")
    const binding = prior?.workId === workId ? prior : { workId, directory, currentActivity: null, lastVerification: null, trackingError: null }
    const ledger = await status(binding)
    binding.closed = ledger.status === "completed"
    if (ledger.checkpointRequired && binding.checkpointUserID === undefined) binding.checkpointUserID = ledger.checkpointUser ?? await latestUserID(sessionID)
    bindings.set(sessionID, binding)
    notify(sessionID, binding, ledger.status === "completed" ? "work.completed" : "work.started")
    return binding
  }

  const registration = await ctx.tool.transform((editor: any) => {
    editor.add({
      name: "work_status",
      description: "Bind an existing portable Work Ledger to this session, or read its derived progress. No Ledger is created. Use only when Intake already selected Ledger-backed work; trivial edits skip this tool.",
      input: { type: "object", properties: { workId: { type: "string", minLength: 1 } }, additionalProperties: false },
      options: { namespace: "andmar", codemode: true },
      execute: async (input: { workId?: string }, context: any) => {
        try {
          if (input.workId) await bind(context.sessionID, input.workId)
          return { content: JSON.stringify(await projection(context.sessionID)) }
        } catch (error) { return { content: `refused: ${String(error)}` } }
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
          const checkpointUser = await latestUserID(context.sessionID)
          const result = await runWorkUnitLifecycle("amend", binding.directory, undefined, { discovery: input, ...(checkpointUser ? { checkpointUser } : {}) })
          if (result.checkpointRequired) binding.checkpointUserID = checkpointUser
          notify(context.sessionID, binding, result.checkpointRequired ? "checkpoint.required" : "work.amended")
          return { content: JSON.stringify(result) }
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
        if (!binding) return { content: "refused: bind the blocked Ledger first" }
        try {
          const ledger = await status(binding)
          const latest = await latestUserID(context.sessionID)
          if (!latest || !binding.checkpointUserID || latest === binding.checkpointUserID) return { content: "refused: waiting for the user's checkpoint response" }
          const unit = ledger.units?.find((candidate) => candidate.state === "blocked")
          if (!unit) return { content: "refused: no blocked Work Unit" }
          const result = await runWorkUnitLifecycle("resume", binding.directory, unit.id, input)
          binding.checkpointUserID = undefined
          notify(context.sessionID, binding, "work.resumed")
          return { content: JSON.stringify(result) }
        } catch (error) { return { content: `refused: ${String(error)}` } }
      },
    })
  })
  if (registration?.dispose) disposers.push(() => void registration.dispose())

  const snapshot = async (): Promise<Map<string, string>> => {
    if (!ctx.vcs?.status) throw new Error("Native VCS status unavailable; shell touches require reconciliation")
    const output = await ctx.vcs.status({ location: { directory: workspace } })
    if (!Array.isArray(output?.data)) throw new Error("Native VCS status returned unsupported file data")
    const paths = normalizeFiles(output.data.map((item: any) => item.file), workspace).filter((file) => !file.startsWith(".andmar/work/"))
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
    const ledger = await status(binding)
    if (ledger.status === "completed") { binding.closed = true; return }
    const tool = toolName(event.tool)
    if (ledger.checkpointRequired && !READ_TOOLS.has(tool) && !["andmar_work_status", "andmar_work_resume", "andmar_task_contract"].includes(tool)) {
      // Fail closed only for a real exception, never for an unlisted file.
      if (binding.checkpointUserID === undefined) binding.checkpointUserID = ledger.checkpointUser ?? await latestUserID(event.sessionID)
      notify(event.sessionID, binding, "checkpoint.required")
      throw new Error("AndMar checkpoint required: execution paused until resolved")
    }
    if (tool.startsWith("andmar_")) return
    let filesBefore: Map<string, string> | undefined
    if (ledger.active && SHELL_TOOLS.has(event.tool)) {
      try { filesBefore = await snapshot() } catch (error) { binding.trackingError = String(error) }
    }
    calls.set(event.id, { binding, ...(ledger.active ? { unit: ledger.active } : {}), before: ledger, activity: `Running ${event.tool}`, filesBefore })
    binding.currentActivity = `Running ${event.tool}` // no commands/output/prompts
    notify(event.sessionID, binding, "work.activity")
  })
  if (before?.dispose) disposers.push(() => void before.dispose())
  const after = await ctx.tool.hook("execute.after", async (event: any) => {
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
        if (changed.length) await runWorkUnitLifecycle("touch", binding.directory, unit, { files: changed })
      }
      const ledger = await status(binding)
      binding.closed = ledger.status === "completed"
      const drift = ledger.units?.find((candidate) => candidate.id === unit)?.drift ?? []
      const oldDrift = call.before.units?.find((candidate) => candidate.id === unit)?.drift ?? []
      if (JSON.stringify(drift) !== JSON.stringify(oldDrift)) notify(event.sessionID, binding, "work.drift")
      if (ledger.checkpointRequired) {
        if (binding.checkpointUserID === undefined) binding.checkpointUserID = ledger.checkpointUser ?? await latestUserID(event.sessionID)
        const blocked = ledger.units?.find((candidate) => candidate.state === "blocked")
        if (blocked && !ledger.checkpointUser && binding.checkpointUserID) {
          await runWorkUnitLifecycle("touch", binding.directory, blocked.id, { checkpointUser: binding.checkpointUserID })
        }
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
