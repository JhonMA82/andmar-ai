#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function computeWorkingStateRevision(cwd = process.cwd()) {
  let root = "";
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    throw new Error(`Not a git repository: ${err?.message || String(err)}`);
  }

  let head = "";
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    head = "EMPTY_TREE";
  }

  const diffBuffer = execFileSync("git", ["diff", "--binary", "HEAD", "--", ".", ":!.andmar/work/**"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const lsFilesRaw = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z", "--", ":!.andmar/work/**"],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  const untrackedFiles = lsFilesRaw
    .toString("utf8")
    .split("\0")
    .filter((f) => f.length > 0)
    .sort();

  const hasher = createHash("sha256");
  hasher.update(`HEAD:${head}\n`);
  hasher.update("DIFF:\n");
  hasher.update(diffBuffer);
  hasher.update("UNTRACKED:\n");

  for (const file of untrackedFiles) {
    const fullPath = resolve(root, file);
    try {
      const content = await readFile(fullPath);
      const fileHash = createHash("sha256").update(content).digest("hex");
      hasher.update(`${file}\0${fileHash}\n`);
    } catch {
      // file might be deleted or unreadable before read
    }
  }

  const revision = hasher.digest("hex");
  return {
    revision,
    excluded: [".andmar/work/**"],
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
  const jsonMode = process.argv.includes("--json");
  try {
    const result = await computeWorkingStateRevision();
    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.revision);
    }
  } catch (error) {
    console.error(error.message || String(error));
    process.exit(2);
  }
}
