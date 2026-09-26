#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { readFile, stat, readdir } from "node:fs/promises";
import { resolve, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_STATUSES = new Set(["active", "completed", "blocked"]);
const ALLOWED_MODES = new Set(["lightweight", "structured"]);

export async function validateWorkLedger(targetDir, options = {}) {
  const errors = [];
  const warnings = [];

  const resolvedTarget = resolve(targetDir);
  const baseDir = options.baseDir ? resolve(options.baseDir) : process.cwd();
  const rel = relative(baseDir, resolvedTarget);
  if (options.checkPathEscape && rel.startsWith("..")) {
    return {
      invocationError: true,
      error: `Path escape detected: target ${resolvedTarget} resolves outside base ${baseDir}`,
    };
  }

  let dirStat;
  try {
    dirStat = await stat(resolvedTarget);
  } catch (err) {
    return {
      invocationError: true,
      error: `Target path does not exist or is not accessible: ${err.message}`,
    };
  }

  if (!dirStat.isDirectory()) {
    return {
      invocationError: true,
      error: `Target path is not a directory: ${resolvedTarget}`,
    };
  }

  const folderName = basename(resolvedTarget);
  let filesInDir = [];
  try {
    filesInDir = await readdir(resolvedTarget);
  } catch (err) {
    return {
      invocationError: true,
      error: `Failed to read target directory: ${err.message}`,
    };
  }

  const hasWorkMd = filesInDir.includes("WORK.md");
  if (!hasWorkMd) {
    errors.push("Missing required WORK.md");
    return { valid: false, errors };
  }

  const workContent = await readFile(resolve(resolvedTarget, "WORK.md"), "utf8");

  // Extract metadata
  let workId = null;
  let status = null;
  let mode = null;

  const fmMatch = workContent.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const wMatch = fm.match(/^work_?id:\s*(.+)$/im);
    if (wMatch) workId = wMatch[1].trim().replace(/^["']|["']$/g, "");
    const sMatch = fm.match(/^status:\s*(.+)$/im);
    if (sMatch) status = sMatch[1].trim().toLowerCase().replace(/^["']|["']$/g, "");
    const mMatch = fm.match(/^(?:intake_)?mode:\s*(.+)$/im);
    if (mMatch) mode = mMatch[1].trim().toLowerCase().replace(/^["']|["']$/g, "");
  }

  if (!workId) {
    const wMatch = workContent.match(/^Work(?:\s+)?ID:\s*(.+)$/im);
    if (wMatch) workId = wMatch[1].trim().replace(/^["']|["']$/g, "");
  }
  if (!status) {
    const sMatch = workContent.match(/^Status:\s*(.+)$/im);
    if (sMatch) status = sMatch[1].trim().toLowerCase().replace(/^["']|["']$/g, "");
  }
  if (!mode) {
    const mMatch = workContent.match(/^(?:Intake\s+)?Mode:\s*(.+)$/im);
    if (mMatch) mode = mMatch[1].trim().toLowerCase().replace(/^["']|["']$/g, "");
  }

  if (!mode) {
    if (filesInDir.includes("SOURCE.md") || filesInDir.includes("REQUIREMENTS.md")) {
      mode = "structured";
    } else {
      mode = "lightweight";
    }
  }

  if (!workId) {
    errors.push("Missing work_id in WORK.md");
  } else if (workId !== folderName) {
    errors.push(`Folder name "${folderName}" does not match work_id "${workId}"`);
  }

  if (!status) {
    errors.push("Missing status in WORK.md");
  } else if (!ALLOWED_STATUSES.has(status)) {
    errors.push(`Invalid status "${status}". Allowed: ${[...ALLOWED_STATUSES].join(", ")}`);
  }

  if (mode && !ALLOWED_MODES.has(mode)) {
    errors.push(`Invalid mode "${mode}". Allowed: ${[...ALLOWED_MODES].join(", ")}`);
  }

  const isStructured = mode === "structured";
  if (isStructured) {
    const requiredFiles = ["SOURCE.md", "REQUIREMENTS.md", "WORK.md", "EVIDENCE.md"];
    for (const reqFile of requiredFiles) {
      if (!filesInDir.includes(reqFile)) {
        errors.push(`Structured ledger missing required file "${reqFile}"`);
      }
    }
  }

  // Parse markdown into sections
  function parseSections(content) {
    const sections = new Map();
    let currentSection = "PREAMBLE";
    sections.set(currentSection, []);

    for (const line of content.split("\n")) {
      const headerMatch = line.match(/^##+\s+(.+)$/);
      if (headerMatch) {
        currentSection = headerMatch[1].trim().toUpperCase();
        if (!sections.has(currentSection)) {
          sections.set(currentSection, []);
        }
      } else {
        sections.get(currentSection).push(line);
      }
    }
    return sections;
  }

  const workSections = parseSections(workContent);

  const declaredReqs = new Set();
  const declaredCons = new Set();
  const declaredWUs = new Set();
  const declaredEvs = new Set();

  function scanDeclaredIds(lines, regex, set, duplicatePrefix) {
    for (const line of lines) {
      // Find matches on lines declaring an item, e.g. - REQ-1 / ## REQ-1
      const match = line.match(regex);
      if (match) {
        const id = match[1].toUpperCase();
        if (set.has(id)) {
          errors.push(`Duplicate ID: ${id}`);
        } else {
          set.add(id);
        }
      }
    }
  }

  // 1. Requirements declarations
  if (filesInDir.includes("REQUIREMENTS.md")) {
    const reqContent = await readFile(resolve(resolvedTarget, "REQUIREMENTS.md"), "utf8");
    for (const line of reqContent.split("\n")) {
      const m = line.match(/^(?:##+|-|\*)\s*(REQ-\d+(?:\.\d+)?)/i);
      if (m) {
        const id = m[1].toUpperCase();
        if (declaredReqs.has(id)) errors.push(`Duplicate ID: ${id}`);
        else declaredReqs.add(id);
      }
    }
  }
  // In WORK.md, scan under REQUIREMENTS section
  for (const [secName, lines] of workSections) {
    if (secName.includes("REQUIREMENT")) {
      for (const line of lines) {
        const m = line.match(/^(?:##+|-|\*)\s*(REQ-\d+(?:\.\d+)?)/i);
        if (m) {
          const id = m[1].toUpperCase();
          if (declaredReqs.has(id)) errors.push(`Duplicate ID: ${id}`);
          else declaredReqs.add(id);
        }
      }
    }
  }

  // 2. Constraints declarations
  if (filesInDir.includes("SOURCE.md")) {
    const srcContent = await readFile(resolve(resolvedTarget, "SOURCE.md"), "utf8");
    for (const line of srcContent.split("\n")) {
      const m = line.match(/^(?:##+|-|\*)\s*(CON-\d+(?:\.\d+)?)/i);
      if (m) {
        const id = m[1].toUpperCase();
        if (declaredCons.has(id)) errors.push(`Duplicate ID: ${id}`);
        else declaredCons.add(id);
      }
    }
  }
  for (const [secName, lines] of workSections) {
    if (secName.includes("CONSTRAINT")) {
      for (const line of lines) {
        const m = line.match(/^(?:##+|-|\*)\s*(CON-\d+(?:\.\d+)?)/i);
        if (m) {
          const id = m[1].toUpperCase();
          if (declaredCons.has(id)) errors.push(`Duplicate ID: ${id}`);
          else declaredCons.add(id);
        }
      }
    }
  }

  // 3. Evidence declarations
  if (filesInDir.includes("EVIDENCE.md")) {
    const evContent = await readFile(resolve(resolvedTarget, "EVIDENCE.md"), "utf8");
    for (const line of evContent.split("\n")) {
      const m = line.match(/^(?:##+|-|\*)\s*(EV-\d+)/i);
      if (m) {
        const id = m[1].toUpperCase();
        if (declaredEvs.has(id)) errors.push(`Duplicate ID: ${id}`);
        else declaredEvs.add(id);
      }
    }
  }
  for (const [secName, lines] of workSections) {
    if (secName.includes("EVIDENCE")) {
      for (const line of lines) {
        const m = line.match(/^(?:##+|-|\*)\s*(EV-\d+)/i);
        if (m) {
          const id = m[1].toUpperCase();
          if (declaredEvs.has(id)) errors.push(`Duplicate ID: ${id}`);
          else declaredEvs.add(id);
        }
      }
    }
  }

  // 4. Work Units in WORK.md
  let activeWUs = 0;
  const referencedReqsInWUs = [];
  const referencedEvsInWUs = [];
  const unitStates = new Map();
  const unitEvidenceRefs = new Map();

  for (const [secName, lines] of workSections) {
    if (secName.includes("WORK UNIT") || secName.includes("UNITS")) {
      let currentWuId = null;
      for (const line of lines) {
        const wuMatch = line.match(/^[-*]\s+\[([ ~x!])\]\s+((?:WU-|W)\d+)/i);
        if (wuMatch) {
          const state = wuMatch[1];
          const id = wuMatch[2].toUpperCase().replace(/^W(?=\d)/, "WU-");
          currentWuId = id;
          if (declaredWUs.has(id)) {
            errors.push(`Duplicate ID: ${id}`);
          } else {
            declaredWUs.add(id);
          }
          unitStates.set(id, state);
          if (state === "~") {
            activeWUs++;
          }
        }

        const reqRefMatch = line.match(/Requirements:\s*(.+)$/i);
        if (reqRefMatch) {
          const ids = reqRefMatch[1].match(/REQ-\d+(?:\.\d+)?/gi);
          if (ids) {
            for (const id of ids) referencedReqsInWUs.push(id.toUpperCase());
          }
        }

        const evRefMatch = line.match(/Evidence:\s*(.+)$/i);
        if (evRefMatch) {
          const ids = evRefMatch[1].match(/EV-\d+/gi);
          if (ids) {
            for (const id of ids) referencedEvsInWUs.push(id.toUpperCase());
            if (currentWuId) unitEvidenceRefs.set(currentWuId, ids.map((id) => id.toUpperCase()));
          }
        }
      }
    }
  }

  if (activeWUs > 1) {
    errors.push(`At most one active Work Unit [~] allowed; found ${activeWUs}`);
  }

  for (const [id, state] of unitStates) {
    if (state === "x" && !(unitEvidenceRefs.get(id)?.length > 0)) {
      errors.push(`Done Work Unit ${id} requires an Evidence: EV-N reference`);
    }
  }

  if (status === "completed" && [...unitStates.values()].some((state) => state !== "x")) {
    errors.push("Completed ledger cannot contain pending, active, or blocked Work Units");
  }

  // 5. Next pointer validation
  let nextText = null;
  for (const [secName, lines] of workSections) {
    if (secName === "NEXT") {
      const nonBlank = lines.map((l) => l.trim()).filter((l) => l.length > 0);
      if (nonBlank.length > 0) nextText = nonBlank[0];
    }
  }
  if (!nextText) {
    const nextLineMatch = workContent.match(/^Next:\s*(.+)$/im);
    if (nextLineMatch) nextText = nextLineMatch[1].trim();
  }

  if (status === "active") {
    if (!nextText) {
      errors.push("Active ledger must specify a Next action");
    } else {
      const nextWuMatch = nextText.match(/(?:WU-|W)\d+/i);
      if (nextWuMatch) {
        const nextId = nextWuMatch[0].toUpperCase().replace(/^W(?=\d)/, "WU-");
        if (!declaredWUs.has(nextId)) {
          errors.push(`Next points to unknown Work Unit "${nextText}" (id ${nextId})`);
        }
      } else {
        errors.push(`Next action does not reference a valid Work Unit: "${nextText}"`);
      }
    }
  }

  // 6. Validate referenced requirements
  for (const refReq of referencedReqsInWUs) {
    if (!declaredReqs.has(refReq)) {
      errors.push(`Work Unit references unknown requirement "${refReq}"`);
    }
  }

  // 7. Validate referenced evidence
  for (const refEv of referencedEvsInWUs) {
    if (!declaredEvs.has(refEv)) {
      errors.push(`Work Unit references unknown evidence "${refEv}"`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    workId,
    status,
    mode,
    stats: {
      requirements: declaredReqs.size,
      constraints: declaredCons.size,
      workUnits: declaredWUs.size,
      evidence: declaredEvs.size,
    },
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
  const target = process.argv[2];
  if (!target) {
    console.error(JSON.stringify({ valid: false, error: "Usage: node scripts/validate-work-ledger.mjs <path-to-ledger-dir>" }, null, 2));
    process.exit(2);
  }

  try {
    const result = await validateWorkLedger(target, { checkPathEscape: true });
    if (result.invocationError) {
      console.error(JSON.stringify({ valid: false, error: result.error }, null, 2));
      process.exit(2);
    }
    if (!result.valid) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ valid: false, error: error.message || String(error) }, null, 2));
    process.exit(2);
  }
}
