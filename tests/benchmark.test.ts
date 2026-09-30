import test from "node:test"
import assert from "node:assert/strict"
import { readFile, writeFile, mkdtemp, rm, chmod, glob, mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { validateTask, validateResult, hash, stableJson, emptyUsage, type Result } from "../bench/schema.ts"
import { parseStats, collectTranscripts, estimateCost, validatePricing } from "../bench/collect.ts"
import { deltaPct, costPerSuccess, compare, summarize, humanReport } from "../bench/compare.ts"
import { runTask, benchmarkEnvironment, validateCommonConfig, matchesFile } from "../bench/runner.ts"
import { execute } from "../bench/process.ts"
import { annotate } from "../bench/annotate.ts"
import { readHarnessState } from "../bench/state.ts"

const root = resolve(import.meta.dirname, "..")
const taskFile = join(root, "bench/tasks/trivial/trivial-button-text.json")
const nativeStats = {
  sessions: 1, subagents: 0, steps: 2, tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 50, write: 10 } }, cost: 0,
  tools: { mode: "detail", totals: { calls: 2, succeeded: 1, failed: 1, unfinished: 0 }, usage: [{ name: "bash", calls: 1, durationP50: 10 }, { name: "andmar_route", calls: 1, durationP50: 30 }] }, models: [{ model: { providerID: "provider", id: "model", variant: "low" } }],
}
function result(mode: "build" | "andmar" = "build", override: Partial<Result> = {}): Result {
  return validateResult({
    schemaVersion: 1, runId: mode, pairId: "pair", repetition: 0, taskId: "task", mode,
    harness: mode === "andmar" ? { version: "0.15.1", revision: "abc", sourceHash: "hash" } : null,
    startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z", durationMs: 1000, agentDurationMs: 900, verificationDurationMs: 100,
    model: "model", variant: "low", provider: "provider", conditions: { task: "same", model: "provider/model#low" }, comparable: true, comparabilityIssues: [],
    ...parseStats(nativeStats).usage, measurement: { source: "native", warnings: [], auxiliaryUsage: "unmeasured", pricing: null },
    exitStatus: 0, timedOut: false, error: null, verification: { passed: true, failedChecks: [], checks: [] },
    changedFiles: [], unexpectedFiles: [], operationalFiles: [], requirements: { total: 2, satisfied: 2, missed: 0 },
    userCorrections: 0, reworkCount: null, quality: { taskSuccess: true, firstPassSuccess: true, falseCompletion: null, completionClaim: null, userInterventions: null },
    contextPressure: { source: "unmeasured", peakPromptTokens: null, contextWindow: null, occupancyPct: null, breakdown: "unmeasured" },
    work: { policyToolCalls: null, product: "unmeasured", policy: "unmeasured", verification: "unmeasured", delegated: "unmeasured" }, developmentMetrics: null, ledgerMetrics: null,
    ...override,
  })
}
test("eight pinned task schemas cover required categories and reject drift/unsafe checks", async () => {
  const counts: Record<string, number> = {}
  for await (const file of glob("bench/tasks/**/*.json", { cwd: root })) {
    const task = validateTask(JSON.parse(await readFile(join(root, file), "utf8")))
    counts[task.category] = (counts[task.category] ?? 0) + 1
    assert.throws(() => validateTask({ ...task, initialFiles: { ...task.initialFiles, injected: "bad" } }), /revision/)
    assert.throws(() => validateTask({ ...task, allowedFiles: ["../outside"] }), /Unsafe/)
    assert.throws(() => validateTask({ ...task, verification: { ...task.verification, commands: [{ id: "../bad", argv: ["node"], timeoutMs: 1 }] } }), /checks/)
    assert.throws(() => validateTask({ ...task, requirements: [{ id: "REQ-1", checks: ["missing"] }] }), /Requirements/)
    assert.throws(() => validateTask({ ...task, repository: "https://example.invalid/repo", baseRevision: "main" }), /commit SHA/)
  }
  assert.deepEqual(counts, { bugfix: 2, feature: 2, integration: 1, refactor: 1, trivial: 2 })
})
test("every fixture verifier rejects the initial state and accepts an independent reference solution", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "bench-fixture-verifiers-"))
  try {
    for await (const file of glob("bench/tasks/**/*.json", { cwd: root })) {
      const task = validateTask(JSON.parse(await readFile(join(root, file), "utf8")))
      const workspace = join(temporary, task.id)
      for (const [name, value] of Object.entries(task.initialFiles!)) {
        await mkdir(resolve(workspace, name, ".."), { recursive: true })
        await writeFile(join(workspace, name), value)
      }
      const run = (check: (typeof task.verification.commands)[number]) => execute(check.argv, workspace, process.env, check.timeoutMs, join(temporary, "out"), join(temporary, "err"))
      let initialFailed = false
      for (const check of task.verification.commands) if ((await run(check)).exitStatus !== 0) { initialFailed = true; break }
      assert.equal(initialFailed, true, `${task.id} must expose an unmet requirement`)
      const put = (name: string, text: string) => writeFile(join(workspace, name), text)
      const get = (name: string) => readFile(join(workspace, name), "utf8")
      switch (task.id) {
        case "trivial-button-text": await put("src/ui.js", (await get("src/ui.js")).replace('"Send"', '"Publish"')); break
        case "trivial-readme-command": await put("README.md", (await get("README.md")).replace("node --test", "npm test")); break
        case "bugfix-add": await put("src/math.js", (await get("src/math.js")).replace("a - b", "a + b")); break
        case "bugfix-clamp": await put("src/math.js", (await get("src/math.js")).replace("Math.min(min, Math.max(max, value))", "Math.min(max, Math.max(min, value))")); break
        case "feature-average": await put("src/math.js", (await get("src/math.js")) + "export function average(values) { return values.length ? values.reduce((a,b)=>a+b,0)/values.length : null; }\n"); break
        case "feature-slug": await put("src/slug.js", 'export function slug(text) { return text.trim().toLowerCase().replace(/\\s+/g,"-"); }\n'); break
        case "refactor-unique": await put("src/list.js", "export function unique(values) { return [...new Set(values)]; }\n"); break
        case "integration-cli-json":
          await put("src/format.js", (await get("src/format.js")) + "export function formatJson(value) { return JSON.stringify({value}); }\n")
          await put("cli.js", 'import {format,formatJson} from "./src/format.js"; const json=process.argv[2]==="--json"; console.log(json?formatJson(process.argv[3]):format(process.argv[2]??"hello"));\n')
          break
      }
      if (task.category === "feature" || task.category === "integration") await put("README.md", (await get("README.md")) + "\naverage slug --json\n")
      for (const path of task.verification.expectedFiles.filter(p => p.startsWith("tests/"))) {
        // The reference authored regression really imports the implemented module.
        const imported = task.id.includes("slug") ? "slug" : task.id.includes("integration") ? "format" : "math"
        const expression = task.id.includes("average") ? "assert.equal(module.average([2,4]),3)" : task.id.includes("slug") ? 'assert.equal(module.slug("A B"),"a-b")' : task.id.includes("clamp") ? "assert.equal(module.clamp(5,0,10),5)" : task.id.includes("integration") ? 'assert.equal(module.format("x"),"x")' : "assert.equal(module.add(2,3),5)"
        await put(path, `import {test} from "node:test"; import {strict as assert} from "node:assert"; import * as module from "../src/${imported}.js"; test("regression",()=>{${expression}});\n`)
      }
      for (const check of task.verification.commands) assert.equal((await run(check)).exitStatus, 0, `${task.id}/${check.id} must accept the reference solution`)
    }
  } finally { await rm(temporary, { recursive: true, force: true }) }
})
test("result schemas reject invalid totals, missing fields and fabricated success", () => {
  const r = result()
  assert.throws(() => validateResult({ ...r, schemaVersion: 2 }), /schema/)
  assert.throws(() => validateResult({ ...r, tokens: { ...r.tokens, total: 1 } }), /total/)
  assert.throws(() => validateResult({ ...r, tokens: { ...r.tokens, input: -1 } }), /input/)
  assert.throws(() => validateResult({ ...r, timedOut: true }), /success/)
  assert.throws(() => validateResult({ ...r, cost: { estimated: null } }), /reported/)
  assert.throws(() => validateResult({ ...r, variant: undefined }), /variant/)
  assert.throws(() => validateResult({ ...r, verification: {} }), /verification/)
})
test("native stats preserve zero reported cost, nullable missing fields and cache/reasoning total", () => {
  const parsed = parseStats(nativeStats)
  assert.equal(parsed.usage.tokens.total, 185)
  assert.equal(parsed.usage.cost.reported, 0)
  assert.equal(parsed.usage.cost.estimated, null)
  assert.equal(parsed.usage.tools.durationP50, null, "cannot average per-tool medians")
  assert.equal(parsed.policyToolCalls, 1)
  assert.deepEqual(parseStats({ data: nativeStats }), parsed)
  assert.deepEqual(parseStats(null).usage, emptyUsage())
  assert.equal(parseStats({ ...nativeStats, tokens: { input: 100 } }).usage.tokens.total, null)
  assert.equal(parseStats({ ...nativeStats, tools: { mode: "none" } }).usage.tools.calls, null)
})
test("estimated API cost needs explicit exact rates and never overwrites reported cost", () => {
  const rates = validatePricing({ schemaVersion: 1, provider: "provider", model: "model", currency: "USD", asOf: "2026-09-30", source: "explicit-test-fixture", perMillion: { input: 1, output: 2, reasoning: 2, cacheRead: 0.1, cacheWrite: 1.25 } })
  const usage = parseStats(nativeStats).usage
  assert.ok(Math.abs(estimateCost(usage, rates)! - 0.0001675) < 1e-15)
  assert.equal(usage.cost.reported, 0)
  assert.equal(estimateCost(usage, null), null)
  assert.equal(estimateCost(emptyUsage(), rates), null)
  assert.throws(() => validatePricing({ ...rates, perMillion: { input: 1 } }), /rates/)
})
test("deterministic export fold deduplicates message/tool IDs and covers child sessions", () => {
  const message = { id: "msg_1", type: "assistant", model: { providerID: "provider", id: "model" }, retry: { attempt: 2 }, tokens: nativeStats.tokens, content: [
    { id: "call_1", type: "tool", name: "bash", state: { status: "completed", content: [] }, time: { ran: 0, completed: 10 } },
    { id: "call_2", type: "tool", name: "andmar_completion_gate", state: { status: "completed", content: [{ type: "text", text: '{"ok":true,"contractClosed":true}' }] }, time: { ran: 0, completed: 20 } },
  ] }
  const parent = { info: { id: "ses_1" }, messages: [{ id: "u1", type: "user" }, message, message] }
  const child = { info: { id: "ses_2", parentID: "ses_1" }, messages: [{ id: "u2", type: "user" }, { ...message, retry: { attempt: 1 }, content: [{ ...message.content[0], time: { ran: 0, completed: 30 } }] }] }
  const d = collectTranscripts([parent, parent, child], true)
  assert.equal(d.retries, 3)
  assert.equal(d.durationP50, 20)
  assert.equal(d.userCorrections, 0)
  assert.equal(d.completionClaim, true)
  assert.equal(d.peakPromptTokens, 160)
  assert.equal(d.andmarObserved, true)
  assert.equal(collectTranscripts([parent], false).retries, null)
  assert.equal(collectTranscripts([{}], true).durationP50, null)
})
test("delta and overhead handle division by zero and unmeasured values", () => {
  assert.equal(deltaPct(100, 130), 30)
  assert.equal(deltaPct(100, 70), -30)
  assert.equal(deltaPct(0, 0), null)
  assert.equal(deltaPct(0, 2), null)
  assert.equal(deltaPct(null, 2), null)
  assert.equal(costPerSuccess(1.8, 6), 0.3)
  assert.equal(costPerSuccess(1, 0), null)
  assert.equal(costPerSuccess(null, 1), null)
  assert.equal(costPerSuccess(0, 2), 0)
})
test("cost per success includes failed runs and propagates unknown samples", () => {
  const failed = result("build", { taskId: "failed", runId: "failed", exitStatus: 1, cost: { reported: 2, estimated: 3 }, quality: { taskSuccess: false, firstPassSuccess: false, falseCompletion: true, completionClaim: true, userInterventions: null } })
  const success = result("build", { cost: { reported: 1, estimated: 2 } })
  const summary = summarize([success, failed])
  assert.equal(summary.reportedCostPerSuccess, 3)
  assert.equal(summary.estimatedCostPerSuccess, 5)
  assert.equal(summary.falseCompletion, null)
  assert.equal(summary.falseCompletionMeasured, 1)
  assert.equal(summarize([failed]).reportedCostPerSuccess, null)
})
test("comparator is reproducible, paired, refuses confounding and supports historical versions", () => {
  const b = result()
  const a = result("andmar", { durationMs: 1300 })
  const b2 = result("build", { taskId: "two", runId: "b2" })
  const a2 = result("andmar", { taskId: "two", runId: "a2" })
  const report = compare([b, b2], [a, a2])
  assert.equal(stableJson(report), stableJson(compare([b2, b], [a2, a])))
  assert.equal(report.pairs[0]!.durationOverheadPct, 30)
  assert.match(humanReport(report), /unmeasured/)
  assert.throws(() => compare([b], [result("andmar", { conditions: { changed: "yes" } })]), /conditions/)
  assert.throws(() => compare([b], [result("andmar", { model: "other" })]), /Mixed models/)
  assert.throws(() => compare([b, b], [a, a]), /Duplicate/)
  assert.throws(() => compare([b], [result("andmar", { comparable: false })]), /not comparable/)
  assert.throws(() => compare([b], []), /equal/)
  const historical = compare([a], [result("andmar", { harness: { version: "0.16.0", revision: "next", sourceHash: "new" } })])
  assert.match(historical.currentIdentity[0]!, /0.16.0/)
})
test("strict config/environment prevent ambient model routers, plugins and Jev accounting leaks", () => {
  assert.deepEqual(validateCommonConfig({ shell: "/bin/bash" }), { shell: "/bin/bash" })
  assert.throws(() => validateCommonConfig({ plugins: ["andmar"] }), /runner owns/)
  assert.throws(() => validateCommonConfig({ agents: {} }), /runner owns/)
  assert.deepEqual(benchmarkEnvironment({ PATH: "/bin", OPENROUTER_API_KEY: "secret", OPENCODE_CONFIG: "ambient", ANDMAR_INTAKE_MODEL: "other" }), { PATH: "/bin" })
  assert.equal(matchesFile("src/a.js", ["src/**"]), true)
  assert.equal(matchesFile("src2/a.js", ["src/**"]), false)
})
test("human completion annotations are explicit and preserve independent verification", () => {
  const r = result("build", { exitStatus: 1, quality: { taskSuccess: false, firstPassSuccess: false, falseCompletion: null, completionClaim: null, userInterventions: null } })
  const annotated = annotate(r, true, "Assessor", "The final text claims success but checks failed")
  assert.equal(validateResult(annotated).quality.falseCompletion, true)
  assert.equal(annotated.humanAssessment.source, "human")
  assert.equal(r.quality.falseCompletion, null)
  assert.throws(() => annotate(r, true, "", ""), /requires/)
})
test("process supervisor handles failed spawn, failed exit and terminates delayed mutation on timeout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bench-process-"))
  try {
    const run = (argv: string[], timeout = 3000) => execute(argv, dir, process.env, timeout, join(dir, "out"), join(dir, "err"))
    const failed = await run([process.execPath, "-e", "process.exit(7)"])
    assert.equal(failed.exitStatus, 7)
    assert.equal(failed.timedOut, false)
    assert.ok((await run([join(dir, "missing-executable")])).error)
    const hung = await run([process.execPath, "-e", 'setTimeout(()=>require("node:fs").writeFileSync("late","bad"),300); setInterval(()=>{},1000)'], 40)
    assert.equal(hung.timedOut, true)
    await new Promise(resolve => setTimeout(resolve, 350))
    await assert.rejects(readFile(join(dir, "late")))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("runner E2E uses native-shaped mock CLI: equivalent pair, failed task, no real LLM", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bench-runner-"))
  try {
    const fake = join(dir, "opencode-mock")
    const currentVersion = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version
    await writeFile(fake, `#!${process.execPath}
import {writeFileSync,readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const args=process.argv.slice(2), db=process.env.OPENCODE_DB;
if(process.env.PWD!==process.cwd())throw new Error('wrong inherited PWD');
const ref={providerID:'provider',id:'model',variant:'low'};
const stats=${JSON.stringify(nativeStats)};
if(args[0]==='run'){
 const mode=args[args.indexOf('--agent')+1]; writeFileSync(db+'.mode',mode);
 const sql=new DatabaseSync(db);sql.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)');
 if(mode==='andmar')sql.prepare('INSERT INTO kv VALUES (?,?)').run('plugin:0061006e0064006d00610072002e00610069:runtime/last-start',JSON.stringify({harnessVersion:${JSON.stringify(currentVersion)}}));sql.close();
 if(process.env.BENCH_TIMEOUT)await new Promise(()=>{setInterval(()=>{},1000)});
 if(!process.env.BENCH_FAIL)writeFileSync('src/ui.js','export const buttonLabel = "Publish";\\nexport const heading = "Welcome";\\n');
 console.log('{}');
}else if(args[0]==='stats'){
 const mode=readFileSync(db+'.mode','utf8');stats.tools.usage=mode==='andmar'?[{name:'andmar_route',calls:2}]:[{name:'edit',calls:2}];console.log(JSON.stringify(stats));
}else if(args[0]==='api'){console.log(JSON.stringify({data:[{id:'ses_mock'}],cursor:{next:null}}));}
else if(args[0]==='session'){
 const mode=readFileSync(db+'.mode','utf8'); console.log(JSON.stringify({info:{id:'ses_mock'},messages:[{id:'msg_user',type:'user'},{id:'msg_a',type:'assistant',model:ref,tokens:stats.tokens,content:mode==='andmar'?[{type:'tool',id:'call_1',name:'andmar_route',state:{status:'completed',content:[]},time:{ran:0,completed:1}}]:[]}]}));
}
`)
    await chmod(fake, 0o755)
    const task = validateTask(JSON.parse(await readFile(taskFile, "utf8")))
    const options = { opencode: fake, model: "provider/model#low", commonConfig: {}, harnessRoot: root, output: join(dir, "results"), tempRoot: join(dir, "temporary"), pairId: "pair", repetition: 0, pricing: null, environment: benchmarkEnvironment(process.env), opencodeVersion: "2.0.20", environmentHash: hash(benchmarkEnvironment(process.env)) }
    const b = await runTask(task, "build", options)
    const a = await runTask(task, "andmar", options)
    const database = join(options.tempRoot, "runtime", "usage.sqlite")
    const beforeState = hash((await readFile(database)).toString("base64"))
    assert.equal((await readHarnessState(database)).lastStart?.harnessVersion, currentVersion)
    assert.equal(hash((await readFile(database)).toString("base64")), beforeState, "state diagnostics must be read-only")
    assert.equal(b.quality.taskSuccess, true)
    assert.equal(a.quality.taskSuccess, true)
    assert.equal(b.cost.reported, 0)
    assert.equal(a.cost.estimated, null)
    assert.equal(compare([b], [a]).pairs.length, 1)
    const failed = await runTask(task, "build", { ...options, environment: { ...options.environment, BENCH_FAIL: "1" } })
    assert.equal(failed.quality.taskSuccess, false)
    assert.equal(failed.requirements.missed, 1)
    assert.ok(failed.verification.failedChecks.includes("label"))
    const invalidSetup = validateTask({ ...task, setup: [{ id: "setup-failure", argv: [process.execPath, "-e", "process.exit(1)"], timeoutMs: 1000 }] })
    const infrastructure = await runTask(invalidSetup, "build", options)
    assert.equal(infrastructure.comparable, false)
    assert.equal(infrastructure.measurement.source, "unmeasured")
    assert.ok(infrastructure.error?.includes("Setup failed"))
    const timedOut = await runTask({ ...task, timeoutMs: 100 }, "build", { ...options, environment: { ...options.environment, BENCH_TIMEOUT: "1" } })
    assert.equal(timedOut.timedOut, true)
    assert.equal(timedOut.quality.taskSuccess, false)
    const unavailable = await readHarnessState(join(dir, "absent.sqlite"))
    assert.equal(unavailable.lastStart, null)
    assert.ok(unavailable.warning)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
