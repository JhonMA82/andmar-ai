#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateWorkLedger } from "./validate-work-ledger.mjs";
import { computeWorkingStateRevision } from "./working-state-revision.mjs";

const UNIT_LINE_RE = /^(\s*[-*]\s+\[)([ ~x!])(\]\s+)((?:WU-|W)\d+)(.*)$/i;
const FULL_REVISION_RE = /^[a-f0-9]{64}$/i;

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
    if (token === "--revision" || token === "--commit") {
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
  return units.map((unit, index) => {
    const blockEnd = index + 1 < units.length ? units[index + 1].line : section.end;
    const fields = {};
    for (let i = unit.line + 1; i < blockEnd; i += 1) {
      const field = lines[i].match(/^\s+-\s+([A-Za-z][A-Za-z -]*):\s*(.*?)\s*$/);
      if (field) fields[field[1].trim().toLowerCase()] = field[2].trim();
    }
    return { ...unit, blockEnd, fields };
  });
}

function stateName(marker) {
  return marker === " " ? "pending" : marker === "~" ? "active" : marker === "x" ? "done" : "blocked";
}

function cleanTitle(suffix, unitId) {
  const title = String(suffix ?? "")
    .replace(/^\s*[—–-]\s*/, "")
    .trim()
    .replace(/\s+/g, " ");
  return title || unitId;
}

function setUnitField(lines, unitId, field, value) {
  const units = parseWorkUnits(lines);
  const target = units.find((unit) => unit.id === unitId);
  if (!target) throw new Error(`Unknown Work Unit: ${unitId}`);
  const fieldRe = new RegExp(`^\\s+-\\s+${field}:`, "i");
  for (let i = target.line + 1; i < target.blockEnd; i += 1) {
    if (fieldRe.test(lines[i])) {
      lines[i] = `  - ${field}: ${value}`;
      return;
    }
  }
  lines.splice(target.line + 1, 0, `  - ${field}: ${value}`);
}

function appendLifecycleEvent(lines, text) {
  const section = findSection(lines, "Lifecycle");
  if (!section) {
    if (lines.length && lines.at(-1) !== "") lines.push("");
    lines.push("## Lifecycle", "", `- ${text}`, "");
    return;
  }
  let insertAt = section.end;
  while (insertAt > section.start + 1 && lines[insertAt - 1] === "") insertAt -= 1;
  lines.splice(insertAt, 0, `- ${text}`);
}

function git(root, args, options = {}) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: options.encoding ?? "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr = error?.stderr?.toString?.("utf8")?.trim();
    throw new Error(stderr || `git ${args.join(" ")} failed`);
  }
}

function gitRoot(cwd) {
  return git(cwd, ["rev-parse", "--show-toplevel"]).trim();
}

function pathWithin(root, absolute) {
  const rel = relative(root, absolute);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`));
}

function splitNull(value) {
  return value.toString("utf8").split("\0").filter(Boolean);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function productGitState(root) {
  const conflicts = splitNull(git(root, ["diff", "--name-only", "--diff-filter=U", "-z", "--", ".", ":!.andmar/work/**"], { encoding: "buffer" }));
  const staged = splitNull(git(root, ["diff", "--cached", "--name-only", "-z", "--", ".", ":!.andmar/work/**"], { encoding: "buffer" }));
  const unstaged = splitNull(git(root, ["diff", "--name-only", "-z", "--", ".", ":!.andmar/work/**"], { encoding: "buffer" }));
  const untracked = splitNull(git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", ":!.andmar/work/**"], { encoding: "buffer" }));
  return {
    conflicts: sortedUnique(conflicts),
    staged: sortedUnique(staged),
    unstaged: sortedUnique(unstaged),
    untracked: sortedUnique(untracked),
    changed: sortedUnique([...staged, ...unstaged, ...untracked]),
  };
}

function commitChangedPaths(root, commit) {
  const parents = git(root, ["rev-list", "--parents", "-n", "1", commit]).trim().split(/\s+/);
  const args = parents.length === 1
    ? ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-z", commit]
    : ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", commit];
  return sortedUnique(splitNull(git(root, args, { encoding: "buffer" })).filter((path) => !path.startsWith(".andmar/work/")));
}

function parseTrailers(message) {
  const trailers = {};
  for (const line of message.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z-]*):\s*(.+?)\s*$/);
    if (match) trailers[match[1].toLowerCase()] = match[2].trim();
  }
  return trailers;
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

function checkpointValue(unit) {
  return String(unit.fields.checkpoint ?? "none").trim();
}

function evidenceIds(unit) {
  const value = unit.fields.evidence ?? "";
  return [...new Set(value.match(/EV-\d+/gi)?.map((id) => id.toUpperCase()) ?? [])];
}

export async function runWorkUnitCheckpoint(command, targetDir, unitArg, options = {}) {
  const resolvedTarget = resolve(targetDir);
  const ledgerMarker = `${sep}.andmar${sep}work${sep}`;
  if (!resolvedTarget.includes(ledgerMarker)) {
    throw new Error(`Work-unit checkpoint may only operate on .andmar/work/<work-id>: ${resolvedTarget}`);
  }

  const validation = await validateOrThrow(resolvedTarget);
  if (validation.status === "completed" && command !== "status") {
    throw new Error("Completed Work Ledger cannot be mutated by work-unit checkpoint");
  }

  const root = gitRoot(resolvedTarget);
  if (!pathWithin(root, resolvedTarget)) throw new Error("Work Ledger must live inside the Git repository being checkpointed");

  const workPath = resolve(resolvedTarget, "WORK.md");
  const original = await readFile(workPath, "utf8");
  let lines = original.replace(/\r\n/g, "\n").split("\n");
  const units = parseWorkUnits(lines);

  if (command === "status") {
    return {
      changed: false,
      workId: validation.workId,
      head: git(root, ["rev-parse", "HEAD"]).trim(),
      units: units.map((unit) => ({
        id: unit.id,
        state: stateName(unit.state),
        checkpoint: checkpointValue(unit),
      })),
    };
  }

  const unitId = normalizeUnitId(unitArg);
  if (!unitId) throw new Error(`A valid Work Unit id is required for ${command}`);
  const unit = units.find((candidate) => candidate.id === unitId);
  if (!unit) throw new Error(`Unknown Work Unit: ${unitId}`);
  if (stateName(unit.state) !== "done") throw new Error(`${command} requires done Work Unit; ${unitId} is ${stateName(unit.state)}`);

  const evidence = evidenceIds(unit);
  if (evidence.length === 0) throw new Error(`${command} requires ${unitId} to reference Evidence: EV-N`);

  const currentCheckpoint = checkpointValue(unit);
  if (command === "prepare") {
    if (currentCheckpoint !== "none") {
      return {
        changed: false,
        ready: false,
        reason: "already-checkpointed",
        workId: validation.workId,
        unit: unitId,
        checkpoint: currentCheckpoint,
      };
    }

    const state = productGitState(root);
    if (state.conflicts.length > 0) throw new Error(`Checkpoint refused while Git conflicts exist: ${state.conflicts.join(", ")}`);
    if (state.changed.length === 0) {
      return {
        changed: false,
        ready: false,
        reason: "no-product-changes",
        workId: validation.workId,
        unit: unitId,
        evidence,
      };
    }

    if (!options.revision || !FULL_REVISION_RE.test(options.revision)) {
      throw new Error("prepare requires --revision <64-char verified working-state revision>");
    }
    const currentRevision = await computeWorkingStateRevision(root);
    if (currentRevision.revision !== options.revision.toLowerCase()) {
      throw new Error(`Verified revision is stale: expected ${options.revision}, current ${currentRevision.revision}`);
    }

    const head = git(root, ["rev-parse", "HEAD"]).trim();
    const title = cleanTitle(unit.titleSuffix, unitId);
    const subject = `${unitId}: ${title}`;
    const message = `${subject}\n\nWork-ID: ${validation.workId}\nWork-Unit: ${unitId}\nVerified-Revision: ${currentRevision.revision}`;

    return {
      changed: false,
      ready: true,
      workId: validation.workId,
      unit: unitId,
      evidence,
      head,
      verifiedRevision: currentRevision.revision,
      changedPaths: state.changed,
      stagedPaths: state.staged,
      unstagedPaths: state.unstaged,
      untrackedPaths: state.untracked,
      commitMessage: message,
    };
  }

  if (command === "record") {
    if (!options.commit?.trim()) throw new Error("record requires --commit <sha>");
    const resolvedCommit = git(root, ["rev-parse", "--verify", `${options.commit.trim()}^{commit}`]).trim();
    const head = git(root, ["rev-parse", "HEAD"]).trim();
    if (resolvedCommit !== head) throw new Error(`record requires the checkpoint commit to be current HEAD; got ${resolvedCommit}, HEAD is ${head}`);

    if (currentCheckpoint !== "none") {
      if (currentCheckpoint.toLowerCase() === resolvedCommit.toLowerCase()) {
        return {
          changed: false,
          workId: validation.workId,
          unit: unitId,
          checkpoint: resolvedCommit,
          alreadyRecorded: true,
        };
      }
      throw new Error(`${unitId} already records checkpoint ${currentCheckpoint}`);
    }

    const message = git(root, ["log", "-1", "--format=%B", resolvedCommit]);
    const trailers = parseTrailers(message);
    if (trailers["work-id"] !== validation.workId) {
      throw new Error(`Checkpoint commit Work-ID trailer must equal ${validation.workId}`);
    }
    if (normalizeUnitId(trailers["work-unit"]) !== unitId) {
      throw new Error(`Checkpoint commit Work-Unit trailer must equal ${unitId}`);
    }
    if (!FULL_REVISION_RE.test(trailers["verified-revision"] ?? "")) {
      throw new Error("Checkpoint commit must contain a 64-char Verified-Revision trailer");
    }

    const productPaths = commitChangedPaths(root, resolvedCommit);
    if (productPaths.length === 0) throw new Error("Checkpoint commit contains no product changes outside .andmar/work/**");

    setUnitField(lines, unitId, "Checkpoint", resolvedCommit);
    appendLifecycleEvent(lines, `${unitId}: checkpoint ${resolvedCommit.slice(0, 12)} (verified ${trailers["verified-revision"].slice(0, 12)})`);
    const updated = `${lines.join("\n").replace(/\n+$/g, "\n")}`;
    await atomicWrite(workPath, updated);

    const after = await validateWorkLedger(resolvedTarget);
    if (after.invocationError || !after.valid) {
      await atomicWrite(workPath, original);
      const detail = after.invocationError ? after.error : after.errors.join("; ");
      throw new Error(`Checkpoint record rolled back because ledger became invalid: ${detail}`);
    }

    return {
      changed: true,
      workId: validation.workId,
      unit: unitId,
      checkpoint: resolvedCommit,
      verifiedRevision: trailers["verified-revision"],
      productPaths,
    };
  }

  throw new Error(`Unknown command: ${command}`);
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
      error: "Usage: node work-unit-checkpoint.mjs <status|prepare|record> <ledger-dir> [WU-N] [--revision sha256] [--commit sha]",
    }, null, 2));
    process.exit(2);
  }

  try {
    const result = await runWorkUnitCheckpoint(args.command, args.targetDir, args.unitArg, args.options);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    process.exit(0);
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2));
    process.exit(1);
  }
}
