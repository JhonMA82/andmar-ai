import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import type { SemanticObservability } from "../../core/observability.ts"
import type { StateStore } from "../../core/contracts.ts"

const execFileAsync = promisify(execFile)
export const ENGRAM_STATUS_KEY = "integrations/engram/status"
const VERSION_TIMEOUT_MS = 2_500

export interface EngramIntegrationStatus {
  provider: "engram"
  mode: "advisory"
  installed: boolean
  configured: boolean
  enabled: boolean
  available: boolean
  availabilityBasis: "binary+config" | "observed-tool-call" | "unavailable"
  version?: string
  configSource?: string
  agentProfile?: boolean
  runtimeObserved: boolean
  lastToolCallAt?: number
  lastToolStatus?: string
  checkedAt: number
}

interface EngramConfigMatch {
  configured: boolean
  enabled: boolean
  agentProfile?: boolean
}

interface DetectOptions {
  env?: Record<string, string | undefined>
  projectRoot?: string
  homeDir?: string
  readText?: (path: string) => Promise<string>
  runVersion?: () => Promise<string>
  now?: () => number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Minimal JSONC normalizer for OpenCode configuration discovery. */
export function stripJsonComments(input: string): string {
  let out = ""
  let inString = false
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!
    const next = input[i + 1]

    if (lineComment) {
      if (char === "\n") {
        lineComment = false
        out += char
      }
      continue
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false
        i += 1
      }
      continue
    }
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === "/" && next === "/") {
      lineComment = true
      i += 1
      continue
    }
    if (char === "/" && next === "*") {
      blockComment = true
      i += 1
      continue
    }
    out += char
  }

  return out.replace(/,\s*([}\]])/g, "$1")
}

function commandParts(entry: Record<string, unknown>): string[] {
  const command = entry.command
  if (Array.isArray(command)) return command.filter((item): item is string => typeof item === "string")
  if (typeof command === "string") {
    const args = Array.isArray(entry.args) ? entry.args.filter((item): item is string => typeof item === "string") : []
    return [command, ...args]
  }
  return []
}

export function extractOpenCodeEngramEntry(raw: string): Record<string, unknown> | undefined {
  let root: unknown
  try {
    root = JSON.parse(stripJsonComments(raw))
  } catch {
    return undefined
  }
  if (!isRecord(root) || !isRecord(root.mcp)) return undefined
  const direct = isRecord(root.mcp.engram) ? root.mcp.engram : undefined
  const servers = isRecord(root.mcp.servers) ? root.mcp.servers : undefined
  const nested = servers && isRecord(servers.engram) ? servers.engram : undefined
  return nested ?? direct
}

function inspectEngramEntry(entry: Record<string, unknown> | undefined): EngramConfigMatch {
  if (!entry) return { configured: false, enabled: false }
  const parts = commandParts(entry)
  const normalized = parts.map((part) => part.toLowerCase())
  const configured = normalized.some((part) => /(^|[\\/])engram(?:\.exe)?$/.test(part) || part === "engram") && normalized.includes("mcp")
  const enabled = configured && entry.enabled !== false && entry.disabled !== true
  const agentProfile = configured ? normalized.includes("--tools=agent") : undefined
  return { configured, enabled, ...(agentProfile !== undefined ? { agentProfile } : {}) }
}

export function inspectOpenCodeEngramConfig(raw: string): EngramConfigMatch {
  return inspectEngramEntry(extractOpenCodeEngramEntry(raw))
}

export function openCodeConfigCandidates(options: Pick<DetectOptions, "env" | "projectRoot" | "homeDir"> = {}): string[] {
  const env = options.env ?? process.env
  const home = options.homeDir ?? homedir()
  const result: string[] = []

  // OpenCode file precedence: global -> OPENCODE_CONFIG -> project -> custom directory.
  const globalDir = resolve(join(home, ".config", "opencode"))
  result.push(join(globalDir, "opencode.json"), join(globalDir, "opencode.jsonc"))
  if (env.OPENCODE_CONFIG?.trim()) result.push(resolve(env.OPENCODE_CONFIG))
  if (options.projectRoot) {
    result.push(join(options.projectRoot, "opencode.json"), join(options.projectRoot, "opencode.jsonc"))
  }
  if (env.OPENCODE_CONFIG_DIR?.trim()) {
    const customDir = resolve(env.OPENCODE_CONFIG_DIR)
    result.push(join(customDir, "opencode.json"), join(customDir, "opencode.jsonc"))
  }
  return [...new Set(result)]
}

async function defaultVersionProbe(): Promise<string> {
  const { stdout } = await execFileAsync("engram", ["version"], {
    encoding: "utf8",
    timeout: VERSION_TIMEOUT_MS,
  })
  const version = stdout.trim()
  if (!version) throw new Error("engram version returned empty output")
  return version
}

export async function detectEngramIntegration(options: DetectOptions = {}): Promise<EngramIntegrationStatus> {
  const now = options.now ?? Date.now
  const readText = options.readText ?? ((path: string) => readFile(path, "utf8"))
  const runVersion = options.runVersion ?? defaultVersionProbe

  let installed = false
  let version: string | undefined
  try {
    version = await runVersion()
    installed = true
  } catch {
    installed = false
  }

  let effectiveEntry: Record<string, unknown> | undefined
  let configSource: string | undefined
  for (const candidate of openCodeConfigCandidates(options)) {
    let raw: string
    try {
      raw = await readText(candidate)
    } catch {
      continue
    }
    const entry = extractOpenCodeEngramEntry(raw)
    if (!entry) continue
    effectiveEntry = { ...(effectiveEntry ?? {}), ...entry }
    configSource = candidate
  }
  const inline = options.env?.OPENCODE_CONFIG_CONTENT ?? process.env.OPENCODE_CONFIG_CONTENT
  if (inline?.trim()) {
    const entry = extractOpenCodeEngramEntry(inline)
    if (entry) {
      effectiveEntry = { ...(effectiveEntry ?? {}), ...entry }
      configSource = "env:OPENCODE_CONFIG_CONTENT"
    }
  }

  const match = inspectEngramEntry(effectiveEntry)
  const configured = match.configured
  const enabled = match.enabled
  const agentProfile = match.agentProfile
  const available = installed && configured && enabled
  return {
    provider: "engram",
    mode: "advisory",
    installed,
    configured,
    enabled,
    available,
    availabilityBasis: available ? "binary+config" : "unavailable",
    ...(version ? { version } : {}),
    ...(configSource ? { configSource } : {}),
    ...(agentProfile !== undefined ? { agentProfile } : {}),
    runtimeObserved: false,
    checkedAt: now(),
  }
}

function engramOperation(tool: unknown): string | undefined {
  if (typeof tool !== "string") return undefined
  const match = tool.match(/^engram[._](mem_[a-z0-9_]+)$/i)
  return match?.[1]?.toLowerCase()
}

export async function setupEngramIntegration(input: {
  ctx: any
  state: StateStore
  observability?: SemanticObservability
}): Promise<() => void> {
  const { ctx, state, observability } = input
  const projectRoot = ctx.location?.project?.canonical ?? ctx.location?.directory
  let status: EngramIntegrationStatus
  try {
    status = await detectEngramIntegration(
      typeof projectRoot === "string" ? { projectRoot } : {},
    )
  } catch {
    status = {
      provider: "engram",
      mode: "advisory",
      installed: false,
      configured: false,
      enabled: false,
      available: false,
      availabilityBasis: "unavailable",
      runtimeObserved: false,
      checkedAt: Date.now(),
    }
  }

  try {
    await state.set(ENGRAM_STATUS_KEY, status)
  } catch {
    // An optional integration must never make AndMar startup fail.
  }

  if (typeof ctx.tool?.hook !== "function") return () => {}

  try {
    const hook = await ctx.tool.hook("execute.after", async (event: any) => {
      const operation = engramOperation(event.tool)
      if (!operation) return
      const at = Date.now()
      const rawInput = event.input !== undefined ? event.input : event.args
      try {
        const current = (await state.get<EngramIntegrationStatus>(ENGRAM_STATUS_KEY)) ?? status
        await state.set(ENGRAM_STATUS_KEY, {
          ...current,
          available: event.status === "completed" ? true : current.available,
          availabilityBasis: event.status === "completed" ? "observed-tool-call" : current.availabilityBasis,
          runtimeObserved: true,
          lastToolCallAt: at,
          lastToolStatus: typeof event.status === "string" ? event.status : "unknown",
        })
      } catch {
        // Memory observability is best-effort and cannot affect the task.
      }

      observability?.emit({
        type: "andmar.runtime",
        sessionID: event.sessionID,
        payload: {
          action: "engram_memory_call",
          operation,
          status: typeof event.status === "string" ? event.status : "unknown",
          crossProject: rawInput?.all_projects === true,
        },
      })
    })

    return () => {
      if (hook?.dispose) void hook.dispose()
    }
  } catch {
    return () => {}
  }
}
