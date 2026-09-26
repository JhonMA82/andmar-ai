#!/usr/bin/env node
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateWorkLedger } from "./validate-work-ledger.mjs";

const UNIT_LINE_RE = /^(\s*[-*]\s+\[)([ ~x!])(\]\s+)((?:WU-|W)\d+)(.*)$/i;

function normalizeUnitId(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (/^W\d+$/.test(text)) return `WU-${text.slice(1)}`;
  if (/^WU-\d+$/.test(text)) return text;
  return null;
}

function parseArgs(argv) {
  const [command, targetDir, unitArg, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--reason" || token === "--evidence" || token === "--next") {
      const value = rest[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
      options[token.slice(2)] = value;
      i += 1;
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
  }
  return { command, targetDir, unitArg, options };
}

function parseSections(lines) {
  const sections = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^##\s+(.+?)\s*$/);
    if (match) sections.push({ name: match[1].trim(), start: i });
  }
  return sections.map((section, index) => ({
    ...section,
    end: index + 1 < sections.length ? sections[index + 1].start : lines.length,
  }));
}

function findSection(lines, name) {
  return parseSections(lines).find((section) => section.name.toLowerCase() === name.toLowerCase());
}

function parseWorkUnits(lines) {
  const section = findSection(lines, "Work Units");
  if (!section) return [];
  const units = [];
  for (let i = section.start + 1; i < section.end; i += 1) {
    const match = lines[i].match(UNIT_LINE_RE);
    if (!match) continue;
    const id = normalizeUnitId(match[4]);
    if (!id) continue;
    units.push({ id, state: match[2], line: i, titleSuffix: match[5] ?? "" });
  }
  return units.map((unit, index) => ({
    ...unit,
    blockEnd: index + 1 < units.length ? units[index + 1].line : section.end,
  }));
}

function markerForState(state) {
  if (state === "pending") return " ";
  if (state === "active") return "~";
  if (state === "done") return "x";
  if (state === "blocked") return "!";
  throw new Error(`Unknown lifecycle state: ${state}`);
}

function stateName(marker) {
  return marker === " " ? "pending" : marker === "~" ? "active" : marker === "x" ? "done" : "blocked";
}

function setUnitState(lines, unitId, nextState) {
  const units = parseWorkUnits(lines);
  const target = units.find((unit) => unit.id === unitId);
  if (!target) throw new Error(`Unknown Work Unit: ${unitId}`);
  const match = lines[target.line].match(UNIT_LINE_RE);
  lines[target.line] = `${match[1]}${markerForState(nextState)}${match[3]}${match[4]}${match[5] ?? ""}`;
}

function setLedgerStatus(lines, status) {
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^([Ss]tatus):\s*.+$/);
    if (!match) continue;
    lines[i] = `${match[1]}: ${status}`;
    return;
  }
  throw new Error("WORK.md has no Status/status field");
}

function setNext(lines, text) {
  const section = findSection(lines, "Next");
  if (!section) {
    if (lines.length && lines.at(-1) !== "") lines.push("");
    lines.push("## Next", "", text, "");
    return;
  }
  lines.splice(section.start + 1, section.end - section.start - 1, "", text, "");
}

function appendLifecycleEvent(lines, text) {
  let section = findSection(lines, "Lifecycle");
  if (!section) {
    if (lines.length && lines.at(-1) !== "") lines.push("");
    lines.push("## Lifecycle", "", `- ${text}`, "");
    return;
  }
  let insertAt = section.end;
  while (insertAt > section.start + 1 && lines[insertAt - 1] === "") insertAt -= 1;
  lines.splice(insertAt, 0, `- ${text}`);
}

function setUnitField(lines, unitId, field, value) {
  const units = parseWorkUnits(lines);
  const target = units.find((unit) => unit.id === unitId);
  if (!target) throw new Error(`Unknown Work Unit: ${unitId}`);
  const fieldRe = new RegExp(`^\\s+-\\s+${field}:`, "i");
  for (let i = target.line + 1; i < target.blockEnd; i += 1) {
    if (fieldRe.test(lines[i])) {
      if (value === null) lines.splice(i, 1);
      else lines[i] = `  - ${field}: ${value}`;
      return;
    }
  }
  if (value !== null) lines.splice(target.line + 1, 0, `  - ${field}: ${value}`);
}

function parseEvidenceIds(value) {
  if (!value) return [];
  const matches = value.match(/EV-\d+/gi) ?? [];
  const ids = [...new Set(matches.map((id) => id.toUpperCase()))];
  return ids;
}

function nextPendingAfter(lines, completedId, explicitNext) {
  const units = parseWorkUnits(lines);
  if (explicitNext) {
    const normalized = normalizeUnitId(explicitNext);
    if (!normalized) throw new Error(`Invalid --next Work Unit: ${explicitNext}`);
    const unit = units.find((candidate) => candidate.id === normalized);
    if (!unit) throw new Error(`Unknown --next Work Unit: ${normalized}`);
    if (unit.state !== " ") throw new Error(`--next ${normalized} must be pending`);
    return unit;
  }
  const completedIndex = units.findIndex((unit) => unit.id === completedId);
  const after = units.slice(completedIndex + 1).find((unit) => unit.state === " ");
  return after ?? units.find((unit) => unit.state === " ") ?? null;
}

async function validateOrThrow(targetDir) {
  const result = await validateWorkLedger(targetDir);
  if (result.invocationError) throw new Error(result.error);
  if (!result.valid) throw new Error(`Ledger validation failed: ${result.errors.join("; ")}`);
  return result;
}

async function atomicWrite(workPath, content) {
  const tempPath = resolve(dirname(workPath), `.WORK.md.andmar-${process.pid}.tmp`);
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, workPath);
}

export async function runWorkUnitLifecycle(command, targetDir, unitArg, options = {}) {
  const resolvedTarget = resolve(targetDir);
  const ledgerMarker = `${sep}.andmar${sep}work${sep}`;
  if (!resolvedTarget.includes(ledgerMarker)) {
    throw new Error(`Work-unit lifecycle may only mutate .andmar/work/<work-id>: ${resolvedTarget}`);
  }

  const validation = await validateOrThrow(resolvedTarget);
  const workPath = resolve(resolvedTarget, "WORK.md");
  const original = await readFile(workPath, "utf8");
  let lines = original.replace(/\r\n/g, "\n").split("\n");
  const unitsBefore = parseWorkUnits(lines);

  const summary = () => {
    const units = parseWorkUnits(lines).map((unit) => ({ id: unit.id, state: stateName(unit.state) }));
    const active = units.find((unit) => unit.state === "active")?.id ?? null;
    const blocked = units.filter((unit) => unit.state === "blocked").map((unit) => unit.id);
    const pending = units.filter((unit) => unit.state === "pending").map((unit) => unit.id);
    const done = units.filter((unit) => unit.state === "done").map((unit) => unit.id);
    return { workId: validation.workId, status: validation.status, mode: validation.mode, active, pending, blocked, done, units };
  };

  if (command === "status") return { changed: false, ...summary() };
  if (validation.status === "completed") throw new Error("Completed Work Ledger cannot be mutated by work-unit lifecycle");

  const unitId = normalizeUnitId(unitArg);
  if (!unitId) throw new Error(`A valid Work Unit id is required for ${command}`);
  const target = unitsBefore.find((unit) => unit.id === unitId);
  if (!target) throw new Error(`Unknown Work Unit: ${unitId}`);
  const current = stateName(target.state);
  const activeOther = unitsBefore.find((unit) => unit.state === "~" && unit.id !== unitId);

  if (command === "activate") {
    if (current !== "pending") throw new Error(`activate requires pending Work Unit; ${unitId} is ${current}`);
    if (activeOther) throw new Error(`Cannot activate ${unitId}; ${activeOther.id} is already active`);
    setUnitState(lines, unitId, "active");
    setLedgerStatus(lines, "active");
    setNext(lines, `${unitId} — active outcome`);
    appendLifecycleEvent(lines, `${unitId}: pending → active`);
  } else if (command === "complete") {
    if (current !== "active") throw new Error(`complete requires active Work Unit; ${unitId} is ${current}`);
    const evidenceIds = parseEvidenceIds(options.evidence);
    if (evidenceIds.length === 0) throw new Error("complete requires --evidence EV-N[,EV-N]");
    setUnitField(lines, unitId, "Evidence", evidenceIds.join(", "));
    setUnitState(lines, unitId, "done");
    const candidate = nextPendingAfter(lines, unitId, options.next);
    if (candidate) {
      setUnitState(lines, candidate.id, "active");
      setNext(lines, `${candidate.id} — active outcome`);
      setLedgerStatus(lines, "active");
      appendLifecycleEvent(lines, `${unitId}: active → done (${evidenceIds.join(", ")}); ${candidate.id}: pending → active`);
    } else {
      setNext(lines, `${unitId} — all work units complete; prepare final verification`);
      setLedgerStatus(lines, "active");
      appendLifecycleEvent(lines, `${unitId}: active → done (${evidenceIds.join(", ")}); no pending Work Units remain`);
    }
  } else if (command === "block") {
    if (current !== "active") throw new Error(`block requires active Work Unit; ${unitId} is ${current}`);
    if (!options.reason?.trim()) throw new Error("block requires --reason");
    setUnitState(lines, unitId, "blocked");
    setUnitField(lines, unitId, "Blocker", options.reason.trim());
    setLedgerStatus(lines, "blocked");
    setNext(lines, `${unitId} — blocked; resolve blocker`);
    appendLifecycleEvent(lines, `${unitId}: active → blocked — ${options.reason.trim()}`);
  } else if (command === "resume") {
    if (current !== "blocked") throw new Error(`resume requires blocked Work Unit; ${unitId} is ${current}`);
    if (!options.reason?.trim()) throw new Error("resume requires --reason describing why the blocker is resolved");
    if (activeOther) throw new Error(`Cannot resume ${unitId}; ${activeOther.id} is already active`);
    setUnitState(lines, unitId, "active");
    setUnitField(lines, unitId, "Blocker", null);
    setLedgerStatus(lines, "active");
    setNext(lines, `${unitId} — resumed outcome`);
    appendLifecycleEvent(lines, `${unitId}: blocked → active — ${options.reason.trim()}`);
  } else if (command === "reopen") {
    if (current !== "done") throw new Error(`reopen requires done Work Unit; ${unitId} is ${current}`);
    if (!options.reason?.trim()) throw new Error("reopen requires --reason");
    if (activeOther) throw new Error(`Cannot reopen ${unitId}; ${activeOther.id} is already active`);
    setUnitState(lines, unitId, "active");
    setUnitField(lines, unitId, "Evidence", null);
    setUnitField(lines, unitId, "Checkpoint", null);
    setLedgerStatus(lines, "active");
    setNext(lines, `${unitId} — reopened outcome`);
    appendLifecycleEvent(lines, `${unitId}: done → active — ${options.reason.trim()}`);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  const updated = `${lines.join("\n").replace(/\n+$/g, "\n")}`;
  await atomicWrite(workPath, updated);
  const after = await validateWorkLedger(resolvedTarget);
  if (after.invocationError || !after.valid) {
    await atomicWrite(workPath, original);
    const detail = after.invocationError ? after.error : after.errors.join("; ");
    throw new Error(`Lifecycle mutation rolled back because ledger became invalid: ${detail}`);
  }

  const finalContent = await readFile(workPath, "utf8");
  lines = finalContent.replace(/\r\n/g, "\n").split("\n");
  const finalUnits = parseWorkUnits(lines).map((unit) => ({ id: unit.id, state: stateName(unit.state) }));
  return {
    changed: true,
    workId: after.workId,
    status: after.status,
    mode: after.mode,
    command,
    unit: unitId,
    active: finalUnits.find((unit) => unit.state === "active")?.id ?? null,
    pending: finalUnits.filter((unit) => unit.state === "pending").map((unit) => unit.id),
    blocked: finalUnits.filter((unit) => unit.state === "blocked").map((unit) => unit.id),
    done: finalUnits.filter((unit) => unit.state === "done").map((unit) => unit.id),
  };
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  }
}

if (isDirectInvocation()) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2));
    process.exit(2);
  }

  if (!args.command || !args.targetDir) {
    console.error(JSON.stringify({
      ok: false,
      error: "Usage: node work-ledger-lifecycle.mjs <status|activate|complete|block|resume|reopen> <ledger-dir> [WU-N] [--evidence EV-N,...] [--reason text] [--next WU-N]",
    }, null, 2));
    process.exit(2);
  }

  try {
    const result = await runWorkUnitLifecycle(args.command, args.targetDir, args.unitArg, args.options);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    process.exit(0);
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2));
    process.exit(1);
  }
}
