#!/usr/bin/env node
// Live OpenCode V2 acceptance; a scripted model drives the real native tools.
// No external model credentials, tool mocks or synthesized hook events.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm } from "node:fs/promises";
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
let server;
try {
  report.runtime = execFileSync(binary, ["--version"], { encoding: "utf8" }).trim();
  assert.match(report.runtime, /v2\./);
  await mkdir(project); await mkdir(config);
  const git = args => execFileSync("git", args, { cwd: project, stdio: "pipe" });
  git(["init"]); git(["config", "user.name", "Acceptance"]); git(["config", "user.email", "acceptance@example.test"]);
  await writeFile(join(project, "product.txt"), "before\n"); git(["add", "."]); git(["commit", "-m", "baseline"]);
  const revision = () => execFileSync(process.execPath, [join(root, "scripts/working-state-revision.mjs")], { cwd: project, encoding: "utf8" }).trim();
  const firstRevision = revision();
  await writeFile(join(project, "product.txt"), "after\n"); const nextRevision = revision(); await writeFile(join(project, "product.txt"), "before\n");
  const frames = [];
  const native = (name, input) => frames.push({ name, input });
  const tool = (name, input) => native("execute", { code: `return await tools.andmar.${name}(${JSON.stringify(input)});` });
  native("skill", { name: "andmar-work-ledger" });
  native("shell", { command: "exit 0" });
  tool("record_receipt", { revision: firstRevision, check: "custom", passed: true, command: "exit 0" });
  tool("verify_revision", { currentRevision: firstRevision, requiredChecks: ["custom"] });
  tool("completion_gate", { currentRevision: firstRevision, taskKind: "internal", docsStatus: "clean", versionStatus: "clean", requiredChecks: ["custom"] });
  native("shell", { command: "exit 7" });
  tool("record_receipt", { revision: firstRevision, check: "custom", passed: true, command: "exit 7" });
  native("write", { path: "product.txt", content: "after\n" });
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
  await writeFile(join(base, "frames.json"), JSON.stringify(frames));
  await mkdir(join(config, "plugins")); await symlink(root, join(config, "plugins/andmar-ai"));
  await mkdir(join(config, "skills"));
  for (const name of await readdir(join(root, "assets/skills"))) await symlink(join(root, "assets/skills", name), join(config, "skills", name));
  await writeFile(join(config, "opencode.json"), JSON.stringify({
    update: "disable", model: "acceptance/scripted",
    providers: { acceptance: {
      package: "aisdk:" + pathToFileURL(fileURLToPath(new URL("./runtime-model.mjs", import.meta.url))).href,
      settings: { apiKey: "local-fixture", frames: join(base, "frames.json") },
      models: { scripted: { capabilities: { tools: true, input: ["text"], output: ["text"] }, limit: { context: 100000, output: 10000 } } },
    } },
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  }));
  const port = 19000 + Math.floor(Math.random() * 10000);
  server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: project, env: { ...process.env, OPENCODE_CONFIG_DIR: config, XDG_DATA_HOME: join(base, "data"), XDG_STATE_HOME: join(base, "state"), XDG_CACHE_HOME: join(base, "cache") }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  const redact = text => text.replace(/server password \S+/g, "server password [redacted]");
  server.on("exit", () => { report.serverLog = redact(logs).slice(-12000); });
  server.stdout.on("data", chunk => logs += chunk.toString()); server.stderr.on("data", chunk => logs += chunk.toString());
  const ready = Date.now() + 30000;
  while (!/server password (\S+)/.test(logs)) {
    if (server.exitCode !== null || Date.now() > ready) throw new Error(`OpenCode did not start: ${redact(logs).slice(-2000)}`);
    await new Promise(done => setTimeout(done, 100));
  }
  const password = logs.match(/server password (\S+)/)[1];
  const api = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
    const content = await response.text();
    if (!response.ok) throw new Error(`${path}: ${response.status} ${content.slice(0, 2000)}`);
    return content ? JSON.parse(content) : null;
  };
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
  for (const skill of fixtureSkills) assert.ok(skill.path.startsWith(join(config, "skills")), `${skill.id} must resolve inside the fixture config, got ${skill.path}: ${discoveryFailure}`);
  const skills = discovered.data.map(skill => skill.id);
  report.checks.push({ name: "native skills discovery", ok: true, packaged, skills });
  const created = await api("/api/session", { title: "AndMar native acceptance", agent: "build", model: { providerID: "acceptance", id: "scripted" }, location: { directory: project }, permissions: [{ action: "*", resource: "*", effect: "allow" }] });
  const sessionID = created.data.id;
  await api(`/api/session/${sessionID}/prompt`, { text: "Run isolated native Verification and Ledger recovery acceptance." });
  await api(`/api/experimental/session/${sessionID}/wait`, {});
  const messages = await api(`/api/session/${sessionID}/context`);
  await writeFile(join(base, "messages.json"), JSON.stringify(messages, null, 2));
  const results = messages.data ?? messages;
  const calls = results.filter(message => message.type === "assistant").flatMap(message => message.content ?? []).filter(part => part.type === "tool");
  assert.equal(calls.length, frames.length, "all requested native calls must settle");
  const output = call => (call.state.content ?? []).filter(part => part.type === "text").map(part => part.text).join("\n");
  const json = call => JSON.parse(output(call));
  const owned = name => calls.filter(call => call.state.metadata?.toolCalls?.[0]?.tool === `andmar.${name}`);
  const shells = calls.filter(call => call.name === "shell");
  assert.equal(shells.find(call => call.state.input.command === "exit 0").state.metadata.exit, 0);
  assert.equal(shells.find(call => call.state.input.command === "exit 7").state.metadata.exit, 7);
  const receipts = owned("record_receipt");
  const accepted = json(receipts[0]);
  assert.equal(accepted.stored, true);
  assert.equal(accepted.receipt.sessionID, sessionID);
  assert.equal(accepted.receipt.executionId, shells.find(call => call.state.input.command === "exit 0").id);
  assert.match(output(receipts[1]), /non-zero exit/);
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
  report.calls = calls.map(call => ({ id: call.id, tool: call.name, status: call.state.status, ...(call.state.metadata?.exit === undefined ? {} : { exit: call.state.metadata.exit }), ...(call.state.metadata?.toolCalls ? { children: call.state.metadata.toolCalls.map(child => child.tool) } : {}) }));
  report.ok = true;
} catch (error) { report.error = String(error); console.error(report.error); process.exitCode = 1; }
finally {
  if (server) { server.kill("SIGTERM"); }
  await mkdir(resolve(reportPath, ".."), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, runtime: report.runtime, checks: report.checks, report: reportPath }));
  if (process.env.ANDMAR_KEEP_ACCEPTANCE !== "1") await rm(base, { recursive: true, force: true });
  else console.log(`Fixture retained at ${base}`);
}
