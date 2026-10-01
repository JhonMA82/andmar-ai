#!/usr/bin/env node
import { mkdir, rename, writeFile, rm, realpath, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readLedgerDocuments, validateLedgerDocuments } from "./validate-work-ledger.mjs";
import { normalizeFiles, projectLedgerDocuments, runWorkUnitLifecycle, withLedgerLock } from "./work-ledger-lifecycle.mjs";

const names = ["WORK.md", "SOURCE.md", "REQUIREMENTS.md", "EVIDENCE.md"];
function text(value, label, max = 4000) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\r\n\0]/.test(value)) throw new Error(`${label} requires a single line (max ${max})`);
  return value.trim();
}
function assertValid(target, documents) {
  const result = validateLedgerDocuments(target, documents);
  if (!result.valid) throw new Error(`Ledger validation failed: ${result.errors.join("; ")}`);
  return result;
}
async function assertPath(target) {
  const root = resolve(target, "../../..");
  if (target !== resolve(root, ".andmar/work", basename(target)) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(basename(target))) throw new Error("Expected .andmar/work/<work-id>");
  // Existing ancestors may not redirect writes outside the repository.
  let ancestor = dirname(target);
  while (true) {
    try {
      if (await realpath(ancestor) !== resolve(await realpath(root), ancestor.slice(root.length + 1))) throw new Error("Ledger path must not escape through symlinks");
      break;
    } catch (error) { if (error.code !== "ENOENT") throw error; ancestor = dirname(ancestor); }
  }
  return root;
}
export function compactStatus(ledger) {
  const { workId, status, active, pending, done, blocked, completionReady, checkpointRequired, checkpointAt, blockedReason } = ledger;
  return { workId, status, active, pending, done, blocked, completionReady, checkpointRequired, checkpointAt, blockedReason };
}

// Cheap invalidation for a session-local projection. No Markdown or history
// survives in the cache; nanosecond ctime/mtime + inode detects replacements.
export async function ledgerVersion(target) {
  return (await Promise.all(names.map(async name => {
    try { const s = await stat(resolve(target, name), { bigint: true }); return `${name}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`; }
    catch (error) { if (error.code !== "ENOENT") throw error; return `${name}:missing`; }
  }))).join("|");
}
export function createLedgerReader() {
  let cached;
  let version;
  return {
    async get(target) {
      const current = await ledgerVersion(target);
      if (cached && current === version) return cached;
      // Retry only a read when an external writer changes the snapshot.
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = await ledgerVersion(target);
        const documents = await readLedgerDocuments(target);
        const after = await ledgerVersion(target);
        if (before !== after) continue;
        cached = projectLedgerDocuments(target, documents, assertValid(target, documents));
        version = after;
        return cached;
      }
      throw new Error("Ledger changed during read; refresh after the writer finishes");
    },
    invalidate() { cached = undefined; version = undefined; },
  };
}

export function serializeLedger(target, input) {
  const workId = basename(target);
  const mode = input.mode ?? "structured";
  if (!["structured", "lightweight"].includes(mode)) throw new Error("Invalid mode");
  const goal = text(input.goal, "goal");
  const title = text(input.title ?? goal, "title", 500);
  if (!Array.isArray(input.requirements) || !input.requirements.length) throw new Error("requirements must be a non-empty array");
  const requirements = input.requirements.map((value, index) => `- REQ-${index + 1}: ${text(value, "requirement")}`).join("\n");
  const constraints = (input.constraints ?? []).map((value, index) => `- CON-${index + 1}: ${text(value, "constraint")}`).join("\n");
  if (!Array.isArray(input.units) || !input.units.length) throw new Error("units must be a non-empty array");
  const units = input.units.map((unit, index) => {
    if (!Array.isArray(unit.requirements) || !unit.requirements.length || unit.requirements.some(id => !/^REQ-[1-9]\d*$/.test(id))) throw new Error("Each unit needs explicit requirement IDs");
    const files = normalizeFiles(unit.expectedFiles ?? [], resolve(target, "../../.."));
    const cons = unit.constraints ?? [];
    if (!Array.isArray(cons) || cons.some(id => !/^CON-[1-9]\d*$/.test(id) || Number(id.slice(4)) > (input.constraints ?? []).length)) throw new Error("Invalid unit constraints");
    return `- [ ] WU-${index + 1} — ${text(unit.title, "unit title", 500)}\n  - Requirements: ${unit.requirements.join(", ")}\n  - Constraints: ${cons.join(", ")}\n  - Acceptance: ${text(unit.acceptance, "acceptance")}\n  - Expected Files: ${JSON.stringify(files)}`;
  }).join("\n");
  const work = `# ${title}\n\nWork ID: ${workId}\nStatus: active\nMode: ${mode}\n\n## Goal\n${goal}\n\n${mode === "lightweight" ? `## Requirements\n${requirements}\n\n## Constraints\n${constraints}\n\n` : ""}## Work Units\n${units}\n\n${mode === "lightweight" ? "## Evidence\n\n" : ""}## Next\nWU-1 — activate first outcome\n`;
  const documents = { "WORK.md": work };
  if (mode === "structured") {
    if (typeof input.source !== "string" || !input.source.trim() || input.source.includes("\0")) throw new Error("structured mode requires source");
    // Quote raw source so user headings cannot become Ledger declarations.
    documents["SOURCE.md"] = `# Source\n\n## Request\n${input.source.split("\n").map(line => `> ${line}`).join("\n")}\n\n## Constraints\n${constraints}\n`;
    documents["REQUIREMENTS.md"] = `# Requirements\n\n${requirements}\n`;
    documents["EVIDENCE.md"] = "# Evidence\n";
  }
  assertValid(target, documents);
  return documents;
}

async function initialize(target, input) {
  await assertPath(target);
  const documents = serializeLedger(target, input);
  await mkdir(dirname(target), { recursive: true });
  const stage = resolve(dirname(target), `.andmar-init-${randomUUID()}`);
  // Claim the final name without ever exposing partially initialized files.
  const lock = `${target}.init-lock`;
  await mkdir(lock);
  try {
    try { await stat(target); throw new Error("Ledger already exists; initialization refuses overwrite"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await mkdir(stage);
    for (const [name, content] of Object.entries(documents)) await writeFile(resolve(stage, name), content, "utf8");
    await rename(stage, target);
    return { changed: true, ...compactStatus(projectLedgerDocuments(target, documents)) };
  } finally { await rm(stage, { recursive: true, force: true }); await rm(lock, { recursive: true }); }
}

function declarations(documents, prefix) {
  const items = new Map();
  for (const content of Object.values(documents)) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(new RegExp(`^(?:##+|[-*])\\s*(${prefix}-\\d+(?:\\.\\d+)?)(?:\\s*[:—-]\\s*(.*))?\\s*$`, "i"));
      if (!m) continue;
      let body = m[2] ?? "";
      if (lines[i].startsWith("#")) {
        let end = i + 1;
        while (end < lines.length && !/^##?\s/.test(lines[end])) end++;
        body = [body, ...lines.slice(i + 1, end)].join("\n").trim();
      }
      items.set(m[1].toUpperCase(), body);
    }
  }
  return items;
}
function section(content, name) {
  const lines = content.split("\n");
  const start = lines.findIndex(line => line.toLowerCase() === `## ${name.toLowerCase()}`);
  if (start < 0) return "";
  let end = start + 1;
  while (end < lines.length && !/^##\s/.test(lines[end])) end++;
  return lines.slice(start + 1, end).join("\n").trim();
}
export function projectContext(target, documents, input = {}) {
  const ledger = projectLedgerDocuments(target, documents);
  if (input.document) {
    if (!names.includes(input.document)) throw new Error("Unknown document");
    const content = documents[input.document];
    return { document: input.document, content: input.section ? section(content ?? "", input.section) : content ?? null };
  }
  for (const [key, prefix] of [["requirement", "REQ"], ["constraint", "CON"], ["evidence", "EV"]]) {
    if (input[key]) return { id: input[key], text: declarations(documents, prefix).get(input[key]) ?? null };
  }
  const id = input.unit ?? ledger.active ?? ledger.blocked?.[0];
  const unit = ledger.units.find(unit => unit.id === id);
  if (!unit) return { workId: ledger.workId, active: null, next: section(documents["WORK.md"], "Next") };
  const lines = section(documents["WORK.md"], "Work Units").split("\n");
  const start = lines.findIndex(line => new RegExp(`^[-*] \\[[ ~x!]\\] ${unit.id}\\b`).test(line));
  let end = start + 1;
  while (end < lines.length && !/^[-*] \[/.test(lines[end])) end++;
  const body = lines.slice(start + 1, end).join("\n");
  const field = name => body.match(new RegExp(`^\\s+- ${name}:\\s*(.*)$`, "m"))?.[1] ?? "";
  const related = (prefix, ids) => ids.map(id => ({ id, text: declarations(documents, prefix).get(id) ?? null }));
  const constraints = declarations(documents, "CON");
  // No unit-specific mapping in older human artifacts means constraints are global.
  const constraintIds = field("Constraints").match(/CON-\d+(?:\.\d+)?/g) ?? [...constraints.keys()];
  return { workId: ledger.workId, goal: section(documents["WORK.md"], "Goal"), unit,
    requirements: related("REQ", field("Requirements").match(/REQ-\d+(?:\.\d+)?/g) ?? []),
    constraints: related("CON", constraintIds), acceptance: field("Acceptance"),
    evidence: related("EV", field("Evidence").match(/EV-\d+/g) ?? []),
    checkpointRequired: ledger.checkpointRequired, blocker: unit.blockedReason,
    next: section(documents["WORK.md"], "Next") };
}

async function recordEvidence(target, input) {
  return withLedgerLock(target, async () => {
    const documents = await readLedgerDocuments(target);
    const validation = assertValid(target, documents);
    if (validation.status === "completed" || validation.status === "blocked") throw new Error("Evidence mutation requires active Ledger");
    const entries = declarations(documents, "EV");
    const id = input.id ?? `EV-${Math.max(0, ...[...entries.keys()].map(id => Number(id.slice(3)))) + 1}`;
    if (!/^EV-[1-9]\d*$/.test(id)) throw new Error("Invalid evidence ID");
    const existing = entries.get(id);
    if (existing !== undefined && !/^pending\b/i.test(existing)) throw new Error(`${id} already contains real evidence; refusing overwrite`);
    const description = text(input.description, "evidence description");
    const name = documents["EVIDENCE.md"] !== undefined ? "EVIDENCE.md" : "WORK.md";
    let content = documents[name];
    if (existing !== undefined) {
      const lines = content.split("\n");
      const start = lines.findIndex(line => new RegExp(`^(?:##+|[-*])\\s*${id}\\b`).test(line));
      let end = start + 1;
      if (lines[start].startsWith("#")) while (end < lines.length && !/^##?\s/.test(lines[end])) end++;
      lines.splice(start, end - start, name === "EVIDENCE.md" ? `## ${id}\n\n${description}\n` : `- ${id}: ${description}`);
      content = lines.join("\n");
    } else if (name === "EVIDENCE.md") content = `${content.trimEnd()}\n\n## ${id}\n\n${description}\n`;
    else {
      if (!/^## Evidence$/m.test(content)) content += "\n## Evidence\n";
      content = content.replace(/^## Evidence\s*$/m, `## Evidence\n- ${id}: ${description}`);
    }
    const next = { ...documents, [name]: content };
    assertValid(target, next);
    const path = resolve(target, name);
    const temp = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temp, content, "utf8"); await rename(temp, path); }
    finally { await rm(temp, { force: true }); }
    return { changed: true, evidence: { id, description }, ...compactStatus(projectLedgerDocuments(target, next)) };
  });
}

export async function runWork(command, targetDir, input = {}) {
  const target = resolve(targetDir);
  if (command === "init") return initialize(target, input);
  if (command === "validate") return validateLedgerDocuments(target, await readLedgerDocuments(target));
  if (command === "context") return projectContext(target, await readLedgerDocuments(target), input);
  if (command === "record-evidence") return recordEvidence(target, input);
  const result = await runWorkUnitLifecycle(command, target, input.unit, input);
  return { changed: result.changed, ...compactStatus(result), ...(result.unit ? { unit: result.unit } : {}),
    ...(command === "amend" ? { continue: result.continue, reasons: result.reasons } : {}),
    ...(command === "finalize" ? { finalRevision: result.finalRevision, completedAt: result.completedAt } : {}) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, target, payload] = process.argv.slice(2);
  try {
    if (!command || !target) throw new Error("Usage: andmar-work.mjs <operation> <ledger-dir> [JSON payload or @payload.json]");
    const input = payload?.startsWith("@") ? JSON.parse(await import("node:fs/promises").then(fs => fs.readFile(payload.slice(1), "utf8"))) : JSON.parse(payload ?? "{}");
    const result = await runWork(command, target, input);
    console.log(JSON.stringify(result));
    if (result.valid === false) process.exitCode = 1;
  } catch (error) { console.log(JSON.stringify({ ok: false, recoveryRequired: true, error: error.message })); process.exitCode = 1; }
}
