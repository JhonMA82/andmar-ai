#!/usr/bin/env node
// Live OpenCode V2 acceptance; a scripted model drives the real native tools.
// No external model credentials, tool mocks or synthesized hook events.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { serializeLedger } from "../../../../scripts/andmar-work.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const binary = process.env.OPENCODE_BIN || "opencode";
const base = await mkdtemp(join(tmpdir(), "andmar-native-acceptance-"));
const project = join(base, "project"), config = join(base, "config");
const reportPath = resolve(process.argv[2] || join(root, ".andmar/runtime-acceptance.json"));
const report = { ok: false, runtime: "", model: "deterministic fixture; native tools/hooks/storage are real", checks: [] };
const redact = text => text.replace(/server password \S+/g, "server password [redacted]");
let server, stop, logs = "";
try {
  report.runtime = execFileSync(binary, ["--version"], { encoding: "utf8" }).trim();
  assert.match(report.runtime, /v2\./);
  await mkdir(project); await mkdir(config);
  const git = args => execFileSync("git", args, { cwd: project, stdio: "pipe" });
  git(["init"]); git(["config", "user.name", "Acceptance"]); git(["config", "user.email", "acceptance@example.test"]);
  await writeFile(join(project, "product.txt"), "before\n");
  await writeFile(join(project, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(require('fs').readFileSync('product.txt','utf8').includes('after') ? 0 : 1)\"" } }));
  git(["add", "."]); git(["commit", "-m", "baseline"]);
  const revision = () => execFileSync(process.execPath, [join(root, "scripts/working-state-revision.mjs")], { cwd: project, encoding: "utf8" }).trim();
  const firstRevision = revision();
  await writeFile(join(project, "product.txt"), "after\n"); const nextRevision = revision(); await writeFile(join(project, "product.txt"), "before\n");
  const frames = [];
  const native = (name, input) => frames.push({ name, input });
  const tool = (name, input) => native("execute", { code: `return await tools.andmar.${name}(${JSON.stringify(input)});` });
  tool("status", {});
  native("skill", { id: "andmar-work-ledger" });
  native("shell", { command: "exit 0" });
  tool("record_receipt", { revision: firstRevision, check: "custom", passed: true, command: "exit 0" });
  tool("verify_revision", { currentRevision: firstRevision, requiredChecks: ["custom"] });
  tool("completion_gate", { currentRevision: firstRevision, taskKind: "internal", docsStatus: "clean", versionStatus: "clean", requiredChecks: ["custom"] });
  native("shell", { command: "exit 7" });
  tool("record_receipt", { revision: firstRevision, check: "custom", passed: true, command: "exit 7" });
  native("shell", { command: "npm test" });
  native("write", { path: "product.txt", content: "after\n" });
  native("shell", { command: "npm test" });
  tool("learning", { op: "pending" });
  tool("incident", { op: "list" });
  tool("verify_revision", { currentRevision: nextRevision, requiredChecks: ["custom"] });
  tool("completion_gate", { currentRevision: nextRevision, taskKind: "internal", docsStatus: "clean", versionStatus: "clean", requiredChecks: ["custom"] });
  for (const [index, corruption] of ["duplicate EV", "invalid WU state", "dangling REQ"].entries()) {
    const workId = `recovery-${index}`;
    const target = join(project, ".andmar/work", workId);
    const payload = { goal: "Recover without restart", requirements: ["Retain valid work"], source: "Acceptance fixture", units: [{ title: "Work", requirements: ["REQ-1"], acceptance: "Session recovered" }] };
    const documents = serializeLedger(target, payload);
    tool("work", { op: "init", workId, payload });
    tool("work", { op: "activate", payload: { unit: "WU-1" } });
    const name = index === 0 ? "EVIDENCE.md" : "WORK.md";
    const valid = index === 0 ? documents[name] : documents[name].replace("[ ] WU-1", "[~] WU-1").replace("WU-1 — activate first outcome", "WU-1 — active outcome") + "\n## Lifecycle\n\n- WU-1: pending → active\n";
    const invalid = index === 0 ? "# Evidence\n\n## EV-8\nReal\n\n## EV-8\nPending\n" : index === 1 ? valid.replace("[~] WU-1", "[?] WU-1") : valid.replace("Requirements: REQ-1", "Requirements: REQ-99");
    const path = `.andmar/work/${workId}/${name}`;
    native("write", { path, content: invalid });
    tool("work_status", {});
    native("shell", { command: `printf forbidden-${index}` });
    native("read", { path });
    native("write", { path, content: valid });
    tool("work_status", {});
    native("execute", { code: `const records = await tools.andmar.incident({op:"list"}); const data = typeof records === "string" ? JSON.parse(records) : records; const incident = data.incidents.find(x => x.workId === ${JSON.stringify(workId)} && x.status === "open"); return await tools.andmar.incident({op:"resolve",id:incident.id,recovery:"Repaired owning Ledger with native write",evidence:"Owning work_status confirms valid state"});` });
    native("shell", { command: `printf recovered-${index}` });
    tool("work", { op: "record-evidence", payload: { description: "Recovered session with native tools" } });
    tool("work", { op: "complete", payload: { unit: "WU-1", evidence: "EV-1" } });
    native("shell", { command: "exit 0" });
    tool("record_receipt", { revision: nextRevision, check: "custom", passed: true, command: "exit 0" });
    tool("verify_revision", { currentRevision: nextRevision, requiredChecks: ["custom"] });
    tool("completion_gate", { currentRevision: nextRevision, taskKind: "internal", docsStatus: "clean", versionStatus: "clean", requiredChecks: ["custom"] });
    native("shell", { command: `node ${JSON.stringify(join(root, "scripts/andmar-work.mjs"))} finalize ${JSON.stringify(target)} '${JSON.stringify({ revision: nextRevision })}'` });
    tool("work_status", {});
  }
  const phases = { initial: frames };
  const phase = name => {
    const batch = phases[name] = [];
    const native = (name, input) => batch.push({ name, input });
    const tool = (name, input) => native("execute", { code: `return await tools.andmar.${name}(${JSON.stringify(input)});` });
    return { native, tool };
  };
  const portable = { goal: "Continue portable outcomes", requirements: ["Retain completed work and continue active work"], source: "Native restart fixture", units: [
    { title: "Already completed", requirements: ["REQ-1"], acceptance: "First outcome observed" },
    { title: "Continue after restart", requirements: ["REQ-1"], acceptance: "Continue the second outcome" },
  ] };
  const staged = phase("staging");
  staged.tool("work", { op: "init", workId: "continuity", payload: portable });
  staged.tool("work", { op: "activate", payload: { unit: "WU-1" } });
  staged.native("shell", { command: "printf portable-seed" });
  staged.tool("work", { op: "record-evidence", payload: { description: "First outcome observed via native shell" } });
  staged.tool("work", { op: "complete", payload: { unit: "WU-1", evidence: "EV-1" } });
  staged.tool("work_status", {});
  const continued = phase("continuation");
  continued.tool("work_status", { workId: "continuity" });
  continued.tool("work_context", {});
  continued.tool("incident", { op: "list" });
  continued.native("skill", { id: "andmar-work-ledger" });
  continued.native("shell", { command: "printf portable-continued" });
  continued.tool("work", { op: "record-evidence", payload: { description: "Second outcome observed after actual server restart" } });
  continued.tool("work", { op: "complete", payload: { unit: "WU-2", evidence: "EV-2" } });
  continued.native("shell", { command: "exit 0" });
  continued.tool("record_receipt", { revision: nextRevision, check: "custom", passed: true, command: "exit 0" });
  continued.tool("verify_revision", { currentRevision: nextRevision, requiredChecks: ["custom"] });
  continued.tool("completion_gate", { currentRevision: nextRevision, taskKind: "internal", docsStatus: "clean", versionStatus: "clean", requiredChecks: ["custom"] });
  continued.native("shell", { command: `node ${JSON.stringify(join(root, "scripts/andmar-work.mjs"))} finalize ${JSON.stringify(join(project, ".andmar/work/continuity"))} '${JSON.stringify({ revision: nextRevision })}'` });
  continued.tool("work_status", {});
  const before = phase("checkpoint-before");
  before.tool("work", { op: "init", workId: "checkpoint", payload: { ...portable, units: [portable.units[0]] } });
  before.tool("work", { op: "activate", payload: { unit: "WU-1" } });
  before.tool("work_amend", { title: "Apply the chosen product option", reason: "A material product choice is unresolved", risk: "medium", withinGoal: true, materialScope: false, humanDecision: true, hardToReverse: false, contradictsContract: false, changesObligation: false });
  before.native("write", { path: "checkpoint-product.txt", content: "forbidden" });
  before.native("shell", { command: "printf forbidden-checkpoint" });
  before.native("read", { path: ".andmar/work/checkpoint/WORK.md" });
  before.tool("work_status", {});
  before.tool("work_status", {});
  before.tool("work_resume", { reason: "No new human response exists yet" });
  const after = phase("checkpoint-after");
  after.tool("work_resume", { reason: "The new user response selected the product option" });
  after.native("write", { path: "checkpoint-product.txt", content: "authorized" });
  after.native("shell", { command: "printf checkpoint-continued" });
  after.tool("work_status", {});
  const learningPhase = phase("learning-promotion");
  learningPhase.native("execute", { code: 'const pending = await tools.andmar.learning({op:"pending"}); const data = typeof pending === "string" ? JSON.parse(pending) : pending; return await tools.andmar.learning({op:"promote",id:data.pending[0].id,name:"native-test-recovery",description:"Recover a failing npm source check",procedure:"Repair the source condition reported by the project check, then rerun npm test and confirm exit zero before accepting the recovery.",evidence:"Native npm test failed, native source write corrected the condition, and the same command exited zero",validated:true,source:"foreground-validated"});' });
  learningPhase.tool("learning", { op: "status" });
  const learnedInvocation = phase("learned-skill");
  learnedInvocation.native("skill", { id: "native-test-recovery" });
  await writeFile(join(base, "frames.json"), JSON.stringify(phases));
  await mkdir(join(config, "plugins")); await symlink(root, join(config, "plugins/andmar-ai"));
  await mkdir(join(config, "agents")); await cp(join(root, "assets/agents/andmar.md"), join(config, "agents/andmar.md"));
  await mkdir(join(config, "skills"));
  for (const entry of await readdir(join(root, "assets/skills"), { withFileTypes: true })) if (entry.isDirectory()) await symlink(join(root, "assets/skills", entry.name), join(config, "skills", entry.name));
  await writeFile(join(config, "opencode.json"), JSON.stringify({
    update: "disable", model: "acceptance/scripted",
    providers: { acceptance: {
      package: "aisdk:" + pathToFileURL(fileURLToPath(new URL("./runtime-model.mjs", import.meta.url))).href,
      settings: { apiKey: "local-fixture", frames: join(base, "frames.json") },
      models: { scripted: { capabilities: { tools: true, input: ["text"], output: ["text"] }, limit: { context: 100000, output: 10000 } } },
    } },
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  }));
  // Preserve filesystem/config/data across a real server restart. Isolate host
  // configuration so an optional host integration cannot become a prerequisite.
  const env = { ...process.env, HOME: join(base, "home"), OPENCODE_CONFIG_DIR: config, XDG_CONFIG_HOME: join(base, "home/.config"), XDG_DATA_HOME: join(base, "data"), XDG_STATE_HOME: join(base, "state"), XDG_CACHE_HOME: join(base, "cache") };
  // CLI 2.0.22 maps this flag directly to models.fetch:false. The fixture
  // provides its only model locally; catalogue HTTP is unnecessary.
  env.OPENCODE_DISABLE_MODELS_FETCH = "1";
  env.OPENCODE_DISABLE_AUTOUPDATE = "1";
  env.ANDMAR_OBSERVABILITY_ENABLED = "0";
  delete env.OPENCODE_CONFIG_CONTENT;
  delete env.OPENCODE_CONFIG;
  let api;
  stop = async () => {
    if (!server || server.exitCode !== null) return;
    const child = server;
    await new Promise((done, reject) => {
      const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("OpenCode stop timed out")); }, 10000);
      child.once("exit", () => { clearTimeout(timeout); done(); });
      child.kill("SIGTERM");
    });
  };
  const start = async () => {
    const port = 19000 + Math.floor(Math.random() * 10000);
    logs = "";
    server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", chunk => logs += chunk.toString()); server.stderr.on("data", chunk => logs += chunk.toString());
    const ready = Date.now() + 30000;
    while (!/server password (\S+)/.test(logs)) {
      if (server.exitCode !== null || Date.now() > ready) throw new Error(`OpenCode did not start: ${redact(logs).slice(-2000)}`);
      await new Promise(done => setTimeout(done, 100));
    }
    const password = logs.match(/server password (\S+)/)[1];
    api = async (path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
      const content = await response.text();
      if (!response.ok) throw new Error(`${path}: ${response.status} ${content.slice(0, 2000)}`);
      return content ? JSON.parse(content) : null;
    };
  };
  await start();
  // Readiness must observe the packaged AndMar skills, never an unrelated count:
  // host-level skills can satisfy a raw length check before this fixture's config
  // directory has been scanned.
  const packaged = (await readdir(join(root, "assets/skills"), { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const fromFixture = body => body.data.filter(skill => packaged.includes(skill.id));
  const skillsOf = body => body.data.map(skill => skill.id);
  let discovered = await api(`/api/skill?location[directory]=${encodeURIComponent(project)}`);
  const skillDeadline = Date.now() + 30000;
  while (fromFixture(discovered).length < packaged.length && Date.now() < skillDeadline) {
    await new Promise(done => setTimeout(done, 200));
    discovered = await api(`/api/skill?location[directory]=${encodeURIComponent(project)}`);
  }
  const fixtureSkills = fromFixture(discovered);
  report.discovered = fixtureSkills.map(({ id, path }) => ({ id, path }));
  const discoveryFailure = `discovered=${JSON.stringify(skillsOf(discovered))} packaged=${JSON.stringify(packaged)} serverLog=${JSON.stringify(redact(logs).slice(-2000))}`;
  assert.deepEqual(fixtureSkills.map(skill => skill.id).sort(), packaged, `native discovery must load every packaged skill from the fixture config: ${discoveryFailure}`);
  for (const skill of fixtureSkills) assert.equal(resolve(skill.path), join(config, "skills", skill.id, "SKILL.md"), `${skill.id} must resolve inside its fixture config directory: ${discoveryFailure}`);
  const skills = discovered.data.map(skill => skill.id);
  report.checks.push({ name: "native skills discovery", ok: true, packaged, skills });
  let agents = await api(`/api/agent?location[directory]=${encodeURIComponent(project)}`);
  const agentDeadline = Date.now() + 30000;
  while (!agents.data.some(agent => agent.id === "andmar") && Date.now() < agentDeadline) {
    await new Promise(done => setTimeout(done, 200));
    agents = await api(`/api/agent?location[directory]=${encodeURIComponent(project)}`);
  }
  const agent = (await api(`/api/agent/andmar?location[directory]=${encodeURIComponent(project)}`)).data;
  assert.equal(agent.id, "andmar"); assert.equal(agent.mode, "primary"); assert.ok(agent.system?.length > 0);
  const created = await api("/api/session", { title: "AndMar native acceptance", agent: "andmar", model: { providerID: "acceptance", id: "scripted" }, location: { directory: project }, permissions: [{ action: "*", resource: "*", effect: "allow" }] });
  const sessionID = created.data.id;
  assert.equal(created.data.agent, "andmar");
  console.log("Native acceptance: AndMar agent, skills, receipts and recovery");
  await api(`/api/session/${sessionID}/prompt`, { text: "acceptance-phase:initial Run isolated native Verification and Ledger recovery acceptance." });
  await api(`/api/experimental/session/${sessionID}/wait`, {});
  const messages = await api(`/api/session/${sessionID}/context`);
  await writeFile(join(base, "messages.json"), JSON.stringify(messages, null, 2));
  const results = messages.data ?? messages;
  const toolCalls = results => results.filter(message => message.type === "assistant").flatMap(message => message.content ?? []).filter(part => part.type === "tool");
  const calls = toolCalls(results);
  assert.equal(calls.length, frames.length, "all requested native calls must settle");
  const output = call => (call.state.content ?? []).filter(part => part.type === "text").map(part => part.text).join("\n");
  const json = call => JSON.parse(output(call));
  const ownedIn = (batch, name) => batch.filter(call => call.state.metadata?.toolCalls?.[0]?.tool === `andmar.${name}`);
  const owned = name => ownedIn(calls, name);
  const integration = json(owned("status")[0]).integrations.engram;
  assert.equal(integration.available, false); assert.equal(integration.mode, "advisory");
  assert.equal(calls.find(call => call.name === "skill").state.status, "completed");
  report.checks.push({ name: "packaged primary agent selected with native skill invocation", ok: true, agent: agent.id, mode: agent.mode });
  report.checks.push({ name: "optional Engram unavailable; startup/status/native execution continue", ok: true, integration });
  const shells = calls.filter(call => call.name === "shell");
  assert.equal(shells.find(call => call.state.input.command === "exit 0").state.metadata.exit, 0);
  assert.equal(shells.find(call => call.state.input.command === "exit 7").state.metadata.exit, 7);
  const receipts = owned("record_receipt");
  const accepted = json(receipts[0]);
  assert.equal(accepted.stored, true);
  assert.equal(accepted.receipt.sessionID, sessionID);
  assert.equal(accepted.receipt.executionId, shells.find(call => call.state.input.command === "exit 0").id);
  assert.match(output(receipts[1]), /non-zero exit/);
  const pending = json(owned("learning")[0]).pending;
  assert.equal(pending.length, 1); assert.equal(pending[0].kind, "RECOVERED_FAILURE");
  assert.equal(json(owned("incident")[0]).incidents.length, 0, "normal project failure must not create internal incidents");
  const incidentRegistry = JSON.parse(await readFile(join(project, ".andmar/incidents/records.json"), "utf8"));
  assert.ok(incidentRegistry.incidents.length >= 1 && incidentRegistry.incidents.length <= 3);
  assert.ok(incidentRegistry.incidents.every(x => x.status === "resolved" && x.recoveryEvidence));
  report.checks.push({ name: "native project failure/correction/success yields one candidate and no incident", ok: true, candidate: pending[0] });
  report.checks.push({ name: "native invalid Ledger records incident and repair resolves same record", ok: true, incidents: incidentRegistry.incidents });
  const verification = owned("verify_revision").map(json);
  assert.equal(verification[0].ok, true);
  assert.equal(verification[1].ok, false);
  assert.deepEqual(verification[1].missing, ["custom"]);
  const gates = owned("completion_gate").map(json);
  assert.equal(gates[0].ok, true);
  assert.equal(gates[1].ok, false);
  for (const index of [0, 1, 2]) {
    const refused = shells.find(call => call.state.input.command === `printf forbidden-${index}`);
    assert.equal(refused.state.status, "error");
    assert.match(refused.state.error.message, /recovery required/);
    const recovered = shells.find(call => call.state.input.command === `printf recovered-${index}`);
    assert.equal(recovered.state.status, "completed");
    assert.equal(recovered.state.metadata.exit, 0);
    assert.equal(output(recovered), `recovered-${index}`);
  }
  report.checks.push({ name: "native shell → observed receipt → Verification → Completion Gate", ok: true, sessionID, firstRevision, nextRevision, nativeExit: [0, 7], passedReceipt: accepted.receipt, staleVerification: verification[1], staleGate: gates[1] });
  report.checks.push({ name: "three corrupt Ledgers recover without session restart", ok: true, cases: ["duplicate EV", "invalid WU state", "dangling REQ"] });
  const runPhase = async (phase, sessionID, decision = "") => {
    console.log(`Native acceptance: ${phase}`);
    const previous = toolCalls((await api(`/api/session/${sessionID}/context`)).data).length;
    const user = await api(`/api/session/${sessionID}/prompt`, { text: `acceptance-phase:${phase} ${decision || "Run the isolated native scenario."}` });
    await api(`/api/experimental/session/${sessionID}/wait`, {});
    const context = (await api(`/api/session/${sessionID}/context`)).data;
    await writeFile(join(base, `${phase}-messages.json`), JSON.stringify(context, null, 2));
    const batch = toolCalls(context).slice(previous);
    assert.equal(batch.length, phases[phase].length, `${phase}: all native calls must settle`);
    calls.push(...batch);
    return { batch, context, user: user.data };
  };
  await runPhase("staging", sessionID);
  const durablePath = join(project, ".andmar/work/continuity/WORK.md");
  const durableBefore = await readFile(durablePath, "utf8");
  assert.match(durableBefore, /\[x\] WU-1/); assert.match(durableBefore, /\[~\] WU-2/);
  const oldPid = server.pid;
  await stop(); await start();
  assert.notEqual(server.pid, oldPid);
  assert.equal(await readFile(durablePath, "utf8"), durableBefore, "restart must retain portable bytes");
  const restarted = await api("/api/session", { title: "AndMar rehydrated continuation", agent: "andmar", model: { providerID: "acceptance", id: "scripted" }, location: { directory: project }, permissions: [{ action: "*", resource: "*", effect: "allow" }] });
  const nextSession = restarted.data.id;
  assert.notEqual(nextSession, sessionID); assert.equal(restarted.data.agent, "andmar");
  const continuation = await runPhase("continuation", nextSession);
  const recoveredProjection = json(ownedIn(continuation.batch, "work_status")[0]);
  assert.equal(recoveredProjection.activeWorkUnit, "WU-2"); assert.deepEqual(recoveredProjection.done, ["WU-1"]);
  assert.equal(json(ownedIn(continuation.batch, "work_context")[0]).unit.id, "WU-2");
  assert.equal(json(ownedIn(continuation.batch, "completion_gate")[0]).ok, true);
  assert.equal(json(ownedIn(continuation.batch, "work_status").at(-1)).status, "completed");
  const interrupted = json(ownedIn(continuation.batch, "incident")[0]).incidents.find(x => x.category === "interrupted-run");
  assert.ok(interrupted); assert.equal(interrupted.workId, "continuity"); assert.equal(interrupted.workUnit, "WU-2");
  report.checks.push({ name: "real restart explains unfinished work with last/next references", ok: true, incident: interrupted });
  const durableAfter = await readFile(durablePath, "utf8");
  assert.equal(durableAfter.match(/WU-1: active → done/g)?.length, 1, "done WU must not repeat");
  report.checks.push({ name: "server restart/new session rebind preserves done WU and continues active WU", ok: true, previousSession: sessionID, newSession: nextSession, activeRecovered: "WU-2", doneRecovered: ["WU-1"] });
  const checkpoint = await runPhase("checkpoint-before", nextSession);
  const blocked = checkpoint.batch.filter(call => call.name === "write" || call.name === "shell");
  assert.ok(blocked.every(call => call.state.status === "error"));
  for (const call of blocked) assert.match(call.state.error.message, /checkpoint required/);
  await assert.rejects(() => readFile(join(project, "checkpoint-product.txt")), /ENOENT/);
  assert.equal(checkpoint.batch.find(call => call.name === "read").state.status, "completed");
  const statuses = ownedIn(checkpoint.batch, "work_status").map(json);
  assert.ok(statuses.every(status => status.checkpointRequired));
  assert.match(output(ownedIn(checkpoint.batch, "work_resume")[0]), /waiting for a user response/);
  const checkpointBytes = await readFile(join(project, ".andmar/work/checkpoint/WORK.md"), "utf8");
  const checkpointAt = Number(checkpointBytes.match(/Checkpoint At: (\d+)/)[1]);
  const previousUser = checkpoint.context.filter(message => message.type === "user").at(-1);
  assert.ok(previousUser.time.created < checkpointAt, "old user message predates material checkpoint");
  const responded = await runPhase("checkpoint-after", nextSession, "I select the product option; apply it and continue the requested work.");
  const newUser = responded.context.filter(message => message.type === "user").at(-1);
  assert.notEqual(newUser.id, previousUser.id); assert.ok(newUser.time.created > checkpointAt, "real new user response must be later than checkpoint");
  assert.equal(json(ownedIn(responded.batch, "work_resume")[0]).status, "active");
  assert.equal(await readFile(join(project, "checkpoint-product.txt"), "utf8"), "authorized");
  assert.equal(responded.batch.find(call => call.name === "shell").state.metadata.exit, 0);
  assert.equal(json(ownedIn(responded.batch, "work_status")[0]).checkpointRequired, false);
  report.checks.push({ name: "material checkpoint refuses old-message/read/status consent; new later user response resumes", ok: true, checkpointAt, previousUserAt: previousUser.time.created, responseAt: newUser.time.created });
  const promoted = await runPhase("learning-promotion", nextSession);
  const promotedResult = output(promoted.batch[0]);
  assert.doesNotMatch(promotedResult, /TypeError|SyntaxError|"ok":false/);
  const discoveryDeadline = Date.now() + 30000;
  let learnedCatalog = await api(`/api/skill?location[directory]=${encodeURIComponent(project)}`);
  while (!skillsOf(learnedCatalog).includes("native-test-recovery") && Date.now() < discoveryDeadline) {
    await new Promise(done => setTimeout(done, 200));
    learnedCatalog = await api(`/api/skill?location[directory]=${encodeURIComponent(project)}`);
  }
  assert.ok(skillsOf(learnedCatalog).includes("native-test-recovery"), "promoted normal project skill is discoverable natively");
  const invokedSkill = await runPhase("learned-skill", nextSession);
  assert.equal(invokedSkill.batch[0].state.status, "completed");
  const promotedContent = await readFile(join(project, ".opencode/skills/native-test-recovery/SKILL.md"), "utf8");
  assert.match(promotedContent, /^---\nname: native-test-recovery/);
  report.checks.push({ name: "explicit foreground promotion creates a natively discoverable ordinary project skill", ok: true });
  report.calls = calls.map(call => ({ id: call.id, tool: call.name, status: call.state.status, ...(call.state.metadata?.exit === undefined ? {} : { exit: call.state.metadata.exit }), ...(call.state.metadata?.toolCalls ? { children: call.state.metadata.toolCalls.map(child => child.tool) } : {}) }));
  await stop();
  report.ok = true;
} catch (error) { report.error = String(error); report.serverLog = redact(logs).slice(-12000); console.error(report.error); process.exitCode = 1; }
finally {
  if (stop) await stop().catch(error => { console.error(String(error)); process.exitCode = 1; });
  await mkdir(resolve(reportPath, ".."), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, runtime: report.runtime, checks: report.checks, report: reportPath }));
  if (process.env.ANDMAR_KEEP_ACCEPTANCE !== "1") await rm(base, { recursive: true, force: true });
  else console.log(`Fixture retained at ${base}`);
}
