import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { computeWorkingStateRevision } from "../scripts/working-state-revision.mjs";

function git(dir: string, args: string[]) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

test("working-state revision: baseline clean repo produces deterministic hash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "andmar-rev-test-"));
  try {
    git(dir, ["init", "-b", "main"]);
    git(dir, ["config", "user.name", "Tester"]);
    git(dir, ["config", "user.email", "tester@example.com"]);
    await writeFile(join(dir, "README.md"), "# Test\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "initial"]);

    const res1 = await computeWorkingStateRevision(dir);
    const res2 = await computeWorkingStateRevision(dir);
    assert.equal(res1.revision, res2.revision);
    assert.deepEqual(res1.excluded, [".andmar/work/**"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("working-state revision: ledger-only untracked file does not change revision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "andmar-rev-test-"));
  try {
    git(dir, ["init", "-b", "main"]);
    git(dir, ["config", "user.name", "Tester"]);
    git(dir, ["config", "user.email", "tester@example.com"]);
    await writeFile(join(dir, "README.md"), "# Test\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "initial"]);

    const baseline = await computeWorkingStateRevision(dir);

    // Create untracked ledger files
    await mkdir(join(dir, ".andmar", "work", "task-1"), { recursive: true });
    await writeFile(join(dir, ".andmar", "work", "task-1", "WORK.md"), "# Work\nStatus: active\n");
    await writeFile(join(dir, ".andmar", "work", "task-1", "EVIDENCE.md"), "# Evidence\n");

    const afterLedger = await computeWorkingStateRevision(dir);
    assert.equal(afterLedger.revision, baseline.revision);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("working-state revision: ledger-only tracked changes do not change revision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "andmar-rev-test-"));
  try {
    git(dir, ["init", "-b", "main"]);
    git(dir, ["config", "user.name", "Tester"]);
    git(dir, ["config", "user.email", "tester@example.com"]);
    await writeFile(join(dir, "README.md"), "# Test\n");
    await mkdir(join(dir, ".andmar", "work", "task-1"), { recursive: true });
    await writeFile(join(dir, ".andmar", "work", "task-1", "WORK.md"), "# Work v1\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "initial with ledger"]);

    const baseline = await computeWorkingStateRevision(dir);

    // Modify tracked ledger file
    await writeFile(join(dir, ".andmar", "work", "task-1", "WORK.md"), "# Work v2 updated\n");

    const afterTrackedLedgerEdit = await computeWorkingStateRevision(dir);
    assert.equal(afterTrackedLedgerEdit.revision, baseline.revision);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("working-state revision: untracked source file changes revision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "andmar-rev-test-"));
  try {
    git(dir, ["init", "-b", "main"]);
    git(dir, ["config", "user.name", "Tester"]);
    git(dir, ["config", "user.email", "tester@example.com"]);
    await writeFile(join(dir, "README.md"), "# Test\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "initial"]);

    const baseline = await computeWorkingStateRevision(dir);

    // Create untracked source file
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "new.ts"), "export const x = 1;\n");

    const afterSource = await computeWorkingStateRevision(dir);
    assert.notEqual(afterSource.revision, baseline.revision);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("working-state revision: tracked source edit changes revision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "andmar-rev-test-"));
  try {
    git(dir, ["init", "-b", "main"]);
    git(dir, ["config", "user.name", "Tester"]);
    git(dir, ["config", "user.email", "tester@example.com"]);
    await writeFile(join(dir, "main.ts"), "console.log(1);\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "initial"]);

    const baseline = await computeWorkingStateRevision(dir);

    await writeFile(join(dir, "main.ts"), "console.log(2);\n");
    const afterEdit = await computeWorkingStateRevision(dir);
    assert.notEqual(afterEdit.revision, baseline.revision);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("working-state revision: staged source edit changes revision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "andmar-rev-test-"));
  try {
    git(dir, ["init", "-b", "main"]);
    git(dir, ["config", "user.name", "Tester"]);
    git(dir, ["config", "user.email", "tester@example.com"]);
    await writeFile(join(dir, "main.ts"), "console.log(1);\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "initial"]);

    const baseline = await computeWorkingStateRevision(dir);

    await writeFile(join(dir, "main.ts"), "console.log(3);\n");
    git(dir, ["add", "main.ts"]);

    const afterStage = await computeWorkingStateRevision(dir);
    assert.notEqual(afterStage.revision, baseline.revision);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("working-state revision: source + ledger combination equals source-only revision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "andmar-rev-test-"));
  try {
    git(dir, ["init", "-b", "main"]);
    git(dir, ["config", "user.name", "Tester"]);
    git(dir, ["config", "user.email", "tester@example.com"]);
    await writeFile(join(dir, "main.ts"), "console.log(1);\n");
    await mkdir(join(dir, ".andmar", "work", "task-1"), { recursive: true });
    await writeFile(join(dir, ".andmar", "work", "task-1", "EVIDENCE.md"), "# Evidence v1\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "initial"]);

    // Case 1: edit source only
    await writeFile(join(dir, "main.ts"), "console.log('modified');\n");
    const sourceOnly = await computeWorkingStateRevision(dir);

    // Case 2: add ledger modifications on top
    await writeFile(join(dir, ".andmar", "work", "task-1", "EVIDENCE.md"), "# Evidence v2\n- EV-1: passed\n");
    await writeFile(join(dir, ".andmar", "work", "task-1", "WORK.md"), "# Work\nStatus: completed\n");

    const sourcePlusLedger = await computeWorkingStateRevision(dir);
    assert.equal(sourcePlusLedger.revision, sourceOnly.revision);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
