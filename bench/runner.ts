import { readFile, writeFile, mkdir, mkdtemp, rm, cp, symlink, lstat, readlink, readdir, realpath } from "node:fs/promises"
import { tmpdir, cpus, totalmem, release } from "node:os"
import { join, resolve, relative, isAbsolute, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { execFileSync, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { performance } from "node:perf_hooks"
import { assert, paths, hash, record, stableJson, validateTask, validateResult, emptyUsage, type Task, type Result, type Mode } from "./schema.ts"
import { parseStats, collectTranscripts, estimateCost, validatePricing, assertPricingMatches, type Pricing } from "./collect.ts"
import { execute } from "./process.ts"
import { buildArgs } from "./adapters/build.ts"
import { andmarArgs } from "./adapters/andmar.ts"
import { readLedgerMetrics } from "../src/capabilities/development-metrics/index.ts"
import { readHarnessState } from "./state.ts"
import { loadSettings } from "./settings.ts"

function git(cwd: string, args: string[], env = process.env): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim()
}
export function modelRef(ref: string) {
  const match = ref.match(/^([^/#]+)\/([^#]+)(?:#([^#]+))?$/)
  assert(match, "Use exact provider/model#variant")
  return { providerID: match[1]!, id: match[2]!, variant: match[3] ?? "default" }
}
/** Ignore operational metadata for product scope, but preserve and validate it separately. */
export function matchesFile(path: string, patterns: string[]): boolean {
  return patterns.some(p => p.endsWith("/**") ? path.startsWith(p.slice(0, -2)) : path === p)
}
export async function snapshot(root: string): Promise<Record<string, string>> {
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean)
  const state: Record<string, string> = {}
  for (const file of [...new Set(files)].sort()) {
    const path = join(root, file)
    try {
      const stat = await lstat(path)
      state[file] = stat.isSymbolicLink() ? `link:${await readlink(path)}` : `${stat.mode & 0o777}:${hash((await readFile(path)).toString("base64"))}`
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e }
  }
  return state
}
/** Only declared paths participate; timestamps and absolute locations do not. */
export async function dependencySnapshot(root: string, declared: string[] = []): Promise<string> {
  assert(paths(declared), "Unsafe dependencyFingerprint paths")
  const entries: Record<string, unknown> = Object.create(null)
  if (declared.length === 0) return hash(entries)
  const workspace = await realpath(root)
  const fingerprint = async (file: string, ancestors: Set<string>): Promise<unknown> => {
    const actual = await realpath(file)
    const rel = relative(workspace, actual)
    assert(rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), `Dependency symlink escapes workspace: ${relative(root, file)}`)
    assert(!ancestors.has(actual), `Dependency symlink cycle: ${relative(root, file)}`)
    const stat = await lstat(file)
    const mode = stat.mode & 0o777
    if (stat.isSymbolicLink()) {
      return { type: "symlink", mode, target: await readlink(file), resolved: await fingerprint(actual, ancestors) }
    }
    if (stat.isFile()) return { type: "file", mode, contentHash: hash((await readFile(file)).toString("base64")) }
    assert(stat.isDirectory(), `Unsupported dependency file type: ${relative(root, file)}`)
    const next = new Set([...ancestors, actual])
    const children: Record<string, unknown> = Object.create(null)
    for (const name of (await readdir(file)).sort()) children[name] = await fingerprint(join(file, name), next)
    return { type: "directory", mode, children }
  }
  for (const file of [...new Set(declared)].sort()) {
    try { entries[file] = await fingerprint(resolve(root, file), new Set()) }
    catch (e) { throw new Error(`dependencyFingerprint ${JSON.stringify(file)}: ${(e as Error).message}`) }
  }
  return hash(entries)
}
/** Full audit patch, without staging or changing the workspace's Git index. */
export function productDiff(workspace: string, baseHead: string): Buffer {
  const output = [execFileSync("git", ["diff", "--binary", "--no-ext-diff", "--no-textconv", baseHead, "--", ".", ":(exclude).andmar/work/**"], { cwd: workspace, maxBuffer: 32 * 1024 * 1024 })]
  const untracked = execFileSync("git", ["ls-files", "-z", "--others", "--exclude-standard"], { cwd: workspace, encoding: "utf8" }).split("\0").filter(Boolean).sort()
  for (const file of untracked.filter(f => !f.startsWith(".andmar/work/"))) {
    const diff = spawnSync("git", ["diff", "--no-index", "--binary", "--no-ext-diff", "--no-textconv", "--", "/dev/null", file], { cwd: workspace, maxBuffer: 32 * 1024 * 1024 })
    if (diff.error) throw diff.error
    assert(diff.status === 0 || diff.status === 1, `Untracked diff failed: ${file}: ${diff.stderr.toString()}`)
    output.push(diff.stdout)
  }
  return Buffer.concat(output)
}
async function readJson(file: string): Promise<any> { return JSON.parse(await readFile(file, "utf8")) }
export interface RunOptions {
  opencode: string
  model: string
  commonConfig: Record<string, unknown>
  harnessRoot: string
  output: string
  tempRoot: string
  pairId: string
  repetition: number
  pricing: Pricing | null
  environment: NodeJS.ProcessEnv
  opencodeVersion: string
  environmentHash: string
}
export function benchmarkEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env }
  for (const key of Object.keys(clean)) if (/^(OPENCODE_|ANDMAR_|XDG_)/.test(key)) delete clean[key]
  // Jev calls fetch directly, outside OpenCode accounting. Strict same-model benchmark uses its existing deterministic fallback.
  delete clean.OPENROUTER_API_KEY
  return clean
}
export function validateCommonConfig(config: unknown): Record<string, unknown> {
  assert(record(config), "Common config must be a JSON object")
  const allowed = ["provider", "permissions", "shell", "snapshots", "formatter", "lsp", "media", "compaction", "tool_output", "watcher", "websearch"]
  assert(Object.keys(config).every(k => allowed.includes(k)), "Common config may only contain provider/permissions/shell/snapshots/formatter/lsp/media/compaction/tool_output/watcher/websearch; runner owns agents/plugins/model")
  return config
}
async function prepare(task: Task, workspace: string, logs: string, env: NodeJS.ProcessEnv): Promise<void> {
  await rm(workspace, { recursive: true, force: true })
  await mkdir(workspace, { recursive: true })
  if (task.repository === "fixture") {
    for (const [file, text] of Object.entries(task.initialFiles!)) {
      const target = join(workspace, file)
      await mkdir(resolve(target, ".."), { recursive: true })
      await writeFile(target, text)
    }
    git(workspace, ["init", "-q"])
    git(workspace, ["add", "."])
    git(workspace, ["-c", "user.name=Benchmark", "-c", "user.email=benchmark@example.invalid", "commit", "-qm", "fixture"], { ...env, GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" })
  } else {
    git(workspace, ["clone", "--no-hardlinks", task.repository, "."])
    git(workspace, ["checkout", "--detach", task.baseRevision])
    assert(git(workspace, ["rev-parse", "HEAD"]) === task.baseRevision, "Base revision mismatch")
  }
  // Ambient project plugins/config would contaminate Build. Reject rather than silently delete them.
  const files = Object.keys(await snapshot(workspace))
  assert(!files.some(f => /(^|\/)(opencode\.jsonc?|\.opencode\/|\.env(?:\.|$))/.test(f)), "Benchmark repository must not contain ambient OpenCode config/plugins or .env; use a sanitized fixture")
  for (const check of task.setup) {
    const result = await execute(check.argv, workspace, env, check.timeoutMs, join(logs, `setup-${check.id}.stdout`), join(logs, `setup-${check.id}.stderr`))
    assert(result.exitStatus === 0 && !result.timedOut && !result.error, `Setup failed: ${check.id}`)
  }
  assert(git(workspace, ["status", "--porcelain"]) === "", "Setup must not mutate tracked/visible repository state")
}
async function runMeasured(task: Task, mode: Mode, options: RunOptions, runId: string): Promise<Result> {
  validateTask(task)
  const ref = modelRef(options.model)
  const artifacts = join(options.output, mode, runId)
  await mkdir(artifacts, { recursive: true, mode: 0o700 })
  const workspace = join(options.tempRoot, "workspace")
  const configDir = join(options.tempRoot, "config")
  const isolated = join(options.tempRoot, "runtime")
  await rm(configDir, { recursive: true, force: true })
  await rm(isolated, { recursive: true, force: true })
  await mkdir(configDir, { recursive: true })
  const env = { ...options.environment, OPENCODE_CONFIG_DIR: configDir, OPENCODE_DB: join(isolated, "usage.sqlite"), XDG_CONFIG_HOME: join(isolated, "config"), XDG_DATA_HOME: join(isolated, "data"), XDG_STATE_HOME: join(isolated, "state"), XDG_CACHE_HOME: join(isolated, "cache") }
  await mkdir(isolated, { recursive: true })
  const pinned = Object.fromEntries(["build", "plan", "general", "explore", ...(mode === "andmar" ? ["andmar"] : [])].map(id => [id, { model: options.model }]))
  const config = { ...options.commonConfig, model: options.model, default_agent: mode, update: "disable", share: "disabled", agents: pinned, plugins: mode === "andmar" ? [{ package: options.harnessRoot, options: { models: { fast: ref, standard: ref, frontier: ref } } }] : [] }
  await writeFile(join(configDir, "opencode.json"), stableJson(config), { mode: 0o600 })
  if (mode === "andmar") {
    await mkdir(join(configDir, "agents"))
    await mkdir(join(configDir, "plugins"))
    await cp(join(options.harnessRoot, "assets", "agents", "andmar.md"), join(configDir, "agents", "andmar.md"))
    // Native helper locality expects this installed path. Explicit options above pin profile models.
    await symlink(options.harnessRoot, join(configDir, "plugins", "andmar-ai"), process.platform === "win32" ? "junction" : "dir")
  }
  await prepare(task, workspace, artifacts, env)
  const before = await snapshot(workspace)
  const beforeLedger = await readLedgerMetrics(workspace)
  const baseHead = git(workspace, ["rev-parse", "HEAD"])
  const dependencyStateHash = await dependencySnapshot(workspace, task.dependencyFingerprint)
  const packageInfo = await readJson(join(options.harnessRoot, "package.json"))
  const harnessFiles = await snapshot(options.harnessRoot)
  const harness = mode === "andmar" ? { version: packageInfo.version, revision: git(options.harnessRoot, ["rev-parse", "HEAD"]), sourceHash: hash(Object.fromEntries(Object.entries(harnessFiles).filter(([f]) => /^(src\/|assets\/|scripts\/|index\.ts$|package\.json$|bun\.lock)/.test(f)))) } : null
  const conditions = {
    taskHash: hash(task), repository: task.repository, baseRevision: task.baseRevision,
    initialStateHash: hash(before), commonConfigHash: hash(options.commonConfig), environmentHash: options.environmentHash,
    opencodeVersion: options.opencodeVersion, nodeVersion: process.version, platform: `${process.platform}/${process.arch}`,
    machineHash: hash({ cpus: cpus().map(cpu => cpu.model), memoryBytes: totalmem(), osRelease: release() }),
    benchmarkCodeHash: hash(Object.fromEntries(await Promise.all(["schema.ts", "runner.ts", "collect.ts", "process.ts", "state.ts", "settings.ts", "adapters/build.ts", "adapters/andmar.ts"].map(async file => [file, await readFile(join(import.meta.dirname, file), "utf8")])))),
    model: options.model, timeoutMs: String(task.timeoutMs), dependencyStateHash,
    pricingHash: hash(options.pricing), protocol: "single-prompt-v1/isolated-db/jev-fallback/auto-permissions",
  }
  const startedAt = new Date().toISOString()
  const started = performance.now()
  const sessionID = `ses_${randomUUID().replaceAll("-", "")}`
  console.error(`[bench] ${task.id} ${mode}: agent running (timeout ${task.timeoutMs} ms)`)
  const processResult = await execute([options.opencode, ...(mode === "build" ? buildArgs : andmarArgs)(options.model, sessionID, task.prompt)], workspace, env, task.timeoutMs, join(artifacts, "agent.jsonl"), join(artifacts, "agent.stderr"))
  const harnessState = await readHarnessState(env.OPENCODE_DB)
  await writeFile(join(artifacts, "harness-state.json"), stableJson(harnessState), { mode: 0o600 })
  // Capture product state BEFORE independent checks; tests are not allowed to manufacture the result.
  const after = await snapshot(workspace)
  const changedFiles = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(f => before[f] !== after[f]).sort()
  const operationalFiles = changedFiles.filter(f => f.startsWith(".andmar/work/"))
  const productChanges = changedFiles.filter(f => !operationalFiles.includes(f))
  const unexpectedFiles = productChanges.filter(f => !matchesFile(f, task.allowedFiles) || matchesFile(f, task.forbiddenFiles))
  const failedChecks: string[] = []
  const checks: Result["verification"]["checks"] = []
  const verificationStarted = performance.now()
  console.error(`[bench] ${task.id} ${mode}: independent verification`)
  for (const check of task.verification.commands) {
    const v = await execute(check.argv, workspace, env, check.timeoutMs, join(artifacts, `verify-${check.id}.stdout`), join(artifacts, `verify-${check.id}.stderr`))
    const passed = v.exitStatus === 0 && !v.timedOut && v.error === null
    checks.push({ id: check.id, passed, exitStatus: v.exitStatus, timedOut: v.timedOut })
    if (!passed) failedChecks.push(check.id)
  }
  for (const file of task.verification.expectedFiles) if (!(file in after)) failedChecks.push(`expected:${file}`)
  if (hash(after) !== hash(await snapshot(workspace))) failedChecks.push("verification-mutated-files")
  for (const file of operationalFiles.filter(f => f.endsWith("/WORK.md") && f in after)) {
    const v = await execute(["node", join(options.harnessRoot, "scripts", "validate-work-ledger.mjs"), resolve(workspace, file, "..")], workspace, env, 10_000, join(artifacts, `ledger-${hash(file)}.stdout`), join(artifacts, `ledger-${hash(file)}.stderr`))
    if (v.exitStatus !== 0 || v.timedOut || v.error) failedChecks.push(`ledger:${file}`)
  }
  const verificationDurationMs = Math.round(performance.now() - verificationStarted)
  const durationMs = Math.round(performance.now() - started)
  const finishedAt = new Date().toISOString()
  await writeFile(join(artifacts, "file-state.json"), stableJson({ before, after, baseHead, finalHead: git(workspace, ["rev-parse", "HEAD"]) }))
  await writeFile(join(artifacts, "product.diff"), productDiff(workspace, baseHead))
  // Preserve final files (including new/untracked files) for inspection; no secrets/config/database copies.
  await cp(workspace, join(artifacts, "final-workspace"), { recursive: true, filter: path => ![".git", "node_modules"].includes(path.split(/[\\/]/).at(-1)!) })
  const warnings: string[] = []
  const issues: string[] = []
  if (harnessState.warning) warnings.push(harnessState.warning)
  if (mode === "andmar" && harnessState.lastStart?.harnessVersion !== packageInfo.version) issues.push("AndMar activation/version not proven by its existing runtime/last-start record")
  if (mode === "build" && harnessState.lastStart !== null) issues.push("AndMar plugin loaded during Build baseline")
  let native: ReturnType<typeof parseStats> = { usage: emptyUsage(), warnings: [], models: [], policyToolCalls: null }
  const stats = await execute([options.opencode, "stats", "--standalone", "--json", "--all", "--full", "--limit", "100000"], workspace, env, 30_000, join(artifacts, "stats.json"), join(artifacts, "stats.stderr"))
  try {
    assert(stats.exitStatus === 0 && !stats.timedOut, "Native stats command failed")
    native = parseStats(await readJson(join(artifacts, "stats.json")))
    warnings.push(...native.warnings)
  } catch (e) { warnings.push((e as Error).message) }
  const exports: unknown[] = []
  let complete = false
  const list = await execute([options.opencode, "api", "GET", "/api/session", "--standalone", "--param", `directory=${workspace}`, "--param", "limit=10000"], workspace, env, 30_000, join(artifacts, "sessions.json"), join(artifacts, "sessions.stderr"))
  try {
    assert(list.exitStatus === 0 && !list.timedOut, "Native session listing failed")
    const data = await readJson(join(artifacts, "sessions.json"))
    const sessions = Array.isArray(data) ? data : data.data
    assert(Array.isArray(sessions), "Unsupported session list")
    // V2 may emit a next cursor even on the terminal page. The isolated native
    // session count establishes completeness without guessing from that cursor.
    complete = sessions.length === native.usage.sessions
    for (const s of sessions) {
      assert(typeof s.id === "string" && /^ses_[a-zA-Z0-9]+$/.test(s.id), "Invalid native session ID")
      const file = join(artifacts, `session-${s.id}.json`)
      const v = await execute([options.opencode, "session", "export", "--standalone", s.id], workspace, env, 30_000, file, `${file}.stderr`)
      if (v.exitStatus !== 0 || v.timedOut) complete = false
      else exports.push(await readJson(file))
    }
  } catch (e) { complete = false; warnings.push((e as Error).message) }
  if (!complete) warnings.push("Incomplete session exports: retries, corrections and global tool median are unmeasured")
  const diagnostics = collectTranscripts(exports, complete)
  if (!complete && native.usage.sessions !== 0) issues.push("Complete session exports required to prove parent/child model and variant parity")
  for (const m of diagnostics.modelRefs) if (m.providerID !== ref.providerID || m.id !== ref.id || (m.variant ?? "default") !== ref.variant) issues.push(`Observed model mismatch: ${m.providerID}/${m.id}#${m.variant ?? "default"}`)
  // Native model aggregates may omit variants; never interpret omission as default.
  for (const entry of native.models) {
    const m = record(entry) && record(entry.model) ? entry.model : null
    if (m && (m.providerID !== ref.providerID || m.id !== ref.id || m.variant !== undefined && m.variant !== ref.variant)) issues.push(`Native model usage mismatch: ${m.providerID}/${m.id}#${m.variant ?? "unmeasured"}`)
  }
  if (mode === "build" && diagnostics.andmarObserved) issues.push("Build session used AndMar tools")
  const usage = native.usage
  usage.retries = diagnostics.retries
  usage.modelErrors = diagnostics.modelErrors
  usage.tools.durationP50 = diagnostics.durationP50
  usage.cost.estimated = estimateCost(usage, options.pricing)
  const satisfied = task.requirements.filter(r => r.checks.every(id => checks.some(c => c.id === id && c.passed))).length
  const verificationPassed = failedChecks.length === 0
  const success = processResult.exitStatus === 0 && !processResult.timedOut && processResult.error === null && verificationPassed && satisfied === task.requirements.length && unexpectedFiles.length === 0
  const ledgerMetrics = await readLedgerMetrics(workspace)
  const result: Result = {
    schemaVersion: 1, runId, pairId: options.pairId, repetition: options.repetition, taskId: task.id, mode, harness,
    startedAt, finishedAt, durationMs, agentDurationMs: processResult.durationMs, verificationDurationMs,
    provider: ref.providerID, model: ref.id, variant: options.model.includes("#") ? ref.variant : null,
    conditions, comparable: issues.length === 0, comparabilityIssues: [...new Set(issues)].sort(),
    ...usage, measurement: { source: "opencode-stats-v2/isolated-db", warnings, auxiliaryUsage: "unmeasured", pricing: options.pricing },
    exitStatus: processResult.exitStatus, timedOut: processResult.timedOut, error: processResult.error,
    verification: { passed: verificationPassed, failedChecks, checks }, changedFiles, unexpectedFiles, operationalFiles,
    requirements: { total: task.requirements.length, satisfied, missed: task.requirements.length - satisfied },
    userCorrections: diagnostics.userCorrections, reworkCount: ledgerMetrics.available && !ledgerMetrics.ledgers.truncated && !beforeLedger.ledgers.truncated && ledgerMetrics.readErrors === 0 && beforeLedger.readErrors === 0 && ledgerMetrics.history.reopenEvents >= beforeLedger.history.reopenEvents ? ledgerMetrics.history.reopenEvents - beforeLedger.history.reopenEvents : null,
    quality: { taskSuccess: success, firstPassSuccess: !success ? false : diagnostics.userCorrections === null ? null : diagnostics.userCorrections === 0, falseCompletion: diagnostics.completionClaim === null ? null : diagnostics.completionClaim && !success, completionClaim: diagnostics.completionClaim, userInterventions: null },
    contextPressure: { source: diagnostics.peakPromptTokens === null ? "unmeasured" : "native-input-usage", peakPromptTokens: diagnostics.peakPromptTokens, contextWindow: null, occupancyPct: null, breakdown: "unmeasured" },
    work: { policyToolCalls: native.policyToolCalls, product: "unmeasured", policy: "unmeasured", verification: "unmeasured", delegated: "unmeasured" },
    developmentMetrics: diagnostics.developmentMetrics ?? (harnessState.aggregate === null ? null : { source: "existing-development-metrics-aggregate", aggregate: harnessState.aggregate }), ledgerMetrics,
  }
  validateResult(result)
  await writeFile(join(artifacts, `${runId}.result.json`), stableJson(result), { mode: 0o600 })
  await writeFile(join(artifacts, "task.json"), stableJson(task))
  console.error(`[bench] ${task.id} ${mode}: success=${success}; tokens=${usage.tokens.total ?? "unmeasured"}`)
  return result
}

/** Infrastructure/preparation failures still produce a result, excluded from fair comparisons. */
export async function runTask(task: Task, mode: Mode, options: RunOptions): Promise<Result> {
  validateTask(task)
  const ref = modelRef(options.model)
  const runId = `${task.id}-${mode}-${randomUUID()}`
  const startedAt = new Date().toISOString()
  const start = performance.now()
  try {
    assertPricingMatches(options.pricing, { provider: ref.providerID, model: ref.id, variant: options.model.includes("#") ? ref.variant : null })
    return await runMeasured(task, mode, options, runId)
  }
  catch (e) {
    const result: Result = {
      schemaVersion: 1, runId, pairId: options.pairId, repetition: options.repetition, taskId: task.id, mode,
      harness: mode === "andmar" ? { version: "unmeasured", revision: "unmeasured", sourceHash: "unmeasured" } : null,
      startedAt, finishedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - start), agentDurationMs: 0, verificationDurationMs: 0,
      model: ref.id, provider: ref.providerID, variant: options.model.includes("#") ? ref.variant : null, conditions: { taskHash: hash(task), model: options.model },
      comparable: false, comparabilityIssues: ["Infrastructure failure; execution equivalence was not established"],
      ...emptyUsage(), measurement: { source: "unmeasured", warnings: ["Incomplete run; inspect artifacts"], auxiliaryUsage: "unmeasured", pricing: options.pricing },
      exitStatus: null, timedOut: false, error: (e as Error).message,
      verification: { passed: false, failedChecks: ["infrastructure"], checks: [] }, changedFiles: [], unexpectedFiles: [], operationalFiles: [],
      requirements: { total: task.requirements.length, satisfied: 0, missed: task.requirements.length }, userCorrections: null, reworkCount: null,
      quality: { taskSuccess: false, firstPassSuccess: false, falseCompletion: null, completionClaim: null, userInterventions: null },
      contextPressure: { source: "unmeasured", peakPromptTokens: null, contextWindow: null, occupancyPct: null, breakdown: "unmeasured" },
      work: { policyToolCalls: null, product: "unmeasured", policy: "unmeasured", verification: "unmeasured", delegated: "unmeasured" }, developmentMetrics: null, ledgerMetrics: null,
    }
    validateResult(result)
    const artifacts = join(options.output, mode, runId)
    await mkdir(artifacts, { recursive: true, mode: 0o700 })
    await writeFile(join(artifacts, `${runId}.result.json`), stableJson(result), { mode: 0o600 })
    console.error(`[bench] ${task.id} ${mode}: infrastructure failure (${result.error})`)
    return result
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let temporary: string | undefined
  try {
    const args = process.argv.slice(2)
    const option = (name: string, fallback?: string) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
    assert(args.includes("--execute"), "LLM runs are opt-in. Usage: bun bench/runner.ts --execute --task FILE --model provider/model#variant [--mode pair|build|andmar] [--output DIR] [--config FILE] [--andmar-root DIR] [--repeat N]")
    assert(process.platform !== "win32", "Runner requires POSIX process-group cancellation; Windows may run under WSL")
    const settings = await loadSettings()
    const model = option("--model", settings?.model)
    assert(model, "Choose a model with bun run bench:configure, or pass --model provider/model#variant")
    const task = validateTask(await readJson(resolve(option("--task", "bench/tasks/trivial/trivial-button-text.json")!)))
    const selected = option("--mode", "pair")!
    assert(["pair", "build", "andmar"].includes(selected), "Invalid mode")
    const ref = modelRef(model)
    const commonConfig = validateCommonConfig(option("--config") ? await readJson(resolve(option("--config")!)) : settings?.commonConfig ?? {})
    const pricing = option("--pricing") ? validatePricing(await readJson(resolve(option("--pricing")!))) : null
    assertPricingMatches(pricing, { provider: ref.providerID, model: ref.id, variant: model.includes("#") ? ref.variant : null })
    const repeat = Number(option("--repeat", "1"))
    assert(Number.isInteger(repeat) && repeat >= 1 && repeat <= 100, "Invalid repeat count")
    const environment = benchmarkEnvironment(process.env)
    const opencode = option("--opencode", "opencode")!
    const opencodeVersion = execFileSync(opencode, ["--version"], { env: { ...environment, XDG_DATA_HOME: tmpdir() }, encoding: "utf8" }).trim()
    assert(/\b(?:v)?2\./.test(opencodeVersion), "OpenCode V2 required")
    temporary = await mkdtemp(join(tmpdir(), "andmar-bench-"))
    const output = resolve(option("--output", `bench/results/${new Date().toISOString().replaceAll(":", "-")}`)!)
    for (let repetition = 0; repetition < repeat; repetition++) {
      const pairId = randomUUID()
      const modes: Mode[] = selected === "pair" ? repetition % 2 ? ["andmar", "build"] : ["build", "andmar"] : [selected as Mode]
      for (const mode of modes) await runTask(task, mode, {
        opencode, model, commonConfig, harnessRoot: resolve(option("--andmar-root", ".")!), output, tempRoot: temporary,
        pairId, repetition, pricing, environment, opencodeVersion, environmentHash: hash(environment),
      })
    }
    console.error(`[bench] Results: ${output}`)
    if (selected === "pair") console.error(`Compare: bun run bench:compare --baseline ${JSON.stringify(join(output, "build"))} --current ${JSON.stringify(join(output, "andmar"))}`)
  } catch (e) { console.error((e as Error).message); process.exitCode = 1 }
  finally { if (temporary) await rm(temporary, { recursive: true, force: true }) }
}
