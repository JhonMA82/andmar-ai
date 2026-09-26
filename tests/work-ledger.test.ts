import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateWorkLedger } from "../scripts/validate-work-ledger.mjs";

test("validator: valid lightweight ledger passes", async () => {
  const base = await mkdtemp(join(tmpdir(), "andmar-ledger-test-"));
  const dir = join(base, "sample-task");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "WORK.md"),
      `# Work — Sample Task

Work ID: sample-task
Status: active
Mode: lightweight

## Goal
Implement a small fix

## Constraints
- CON-1: Do not break API

## Requirements
- REQ-1: Fix typo in button
- REQ-2: Add unit test

## Work Units
- [~] WU-1 — Fix button typo
  - Requirements: REQ-1
- [ ] WU-2 — Add unit test
  - Requirements: REQ-2

## Evidence
- EV-1: bun test tests/ui.test.ts

## Next
WU-1 — Fix button typo
`
    );

    const res = await validateWorkLedger(dir);
    assert.equal(res.valid, true);
    assert.equal(res.errors.length, 0);
    assert.equal(res.mode, "lightweight");
    assert.equal(res.workId, "sample-task");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("validator: valid structured ledger passes", async () => {
  const base = await mkdtemp(join(tmpdir(), "andmar-ledger-test-"));
  const dir = join(base, "auth-system");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SOURCE.md"), "# Source\nCON-1: Zero downtime\n");
    await writeFile(
      join(dir, "REQUIREMENTS.md"),
      `# Requirements
## REQ-1 — Token verification
Status: pending

## REQ-2 — Refresh flow
Status: pending
`
    );
    await writeFile(
      join(dir, "EVIDENCE.md"),
      `# Evidence
## EV-1
Result: passed
`
    );
    await writeFile(
      join(dir, "WORK.md"),
      `# Work — Auth System

Work ID: auth-system
Status: active
Mode: structured

## Goal
Upgrade authentication architecture

## Constraints
- CON-1: Zero downtime

## Work Units
- [x] WU-1 — Token verification
  - Requirements: REQ-1
  - Evidence: EV-1
- [~] WU-2 — Refresh flow
  - Requirements: REQ-2

## Next
WU-2 — Refresh flow
`
    );

    const res = await validateWorkLedger(dir);
    assert.equal(res.valid, true);
    assert.equal(res.errors.length, 0);
    assert.equal(res.mode, "structured");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("validator: structured missing required file fails", async () => {
  const base = await mkdtemp(join(tmpdir(), "andmar-ledger-test-"));
  const dir = join(base, "missing-file-task");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SOURCE.md"), "# Source\n");
    // Missing REQUIREMENTS.md and EVIDENCE.md
    await writeFile(
      join(dir, "WORK.md"),
      `# Work

Work ID: missing-file-task
Status: active
Mode: structured

## Work Units
- [~] WU-1 — Start task

## Next
WU-1
`
    );

    const res = await validateWorkLedger(dir);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e: string) => e.includes("REQUIREMENTS.md")));
    assert.ok(res.errors.some((e: string) => e.includes("EVIDENCE.md")));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("validator: duplicate REQ ID fails", async () => {
  const base = await mkdtemp(join(tmpdir(), "andmar-ledger-test-"));
  const dir = join(base, "dup-req");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "WORK.md"),
      `# Work
Work ID: dup-req
Status: active
Mode: lightweight

## Requirements
- REQ-1: First obligation
- REQ-1: Duplicate obligation

## Work Units
- [~] WU-1 — Do work

## Next
WU-1
`
    );

    const res = await validateWorkLedger(dir);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e: string) => e.includes("Duplicate ID: REQ-1")));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("validator: duplicate WU ID fails", async () => {
  const base = await mkdtemp(join(tmpdir(), "andmar-ledger-test-"));
  const dir = join(base, "dup-wu");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "WORK.md"),
      `# Work
Work ID: dup-wu
Status: active
Mode: lightweight

## Work Units
- [ ] WU-1 — Step A
- [~] WU-1 — Duplicate Step B

## Next
WU-1
`
    );

    const res = await validateWorkLedger(dir);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e: string) => e.includes("Duplicate ID: WU-1")));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("validator: two active WUs fail", async () => {
  const base = await mkdtemp(join(tmpdir(), "andmar-ledger-test-"));
  const dir = join(base, "two-active");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "WORK.md"),
      `# Work
Work ID: two-active
Status: active
Mode: lightweight

## Work Units
- [~] WU-1 — Step A
- [~] WU-2 — Step B

## Next
WU-1
`
    );

    const res = await validateWorkLedger(dir);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e: string) => e.includes("At most one active Work Unit")));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("validator: invalid Next pointer fails", async () => {
  const base = await mkdtemp(join(tmpdir(), "andmar-ledger-test-"));
  const dir = join(base, "invalid-next");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "WORK.md"),
      `# Work
Work ID: invalid-next
Status: active
Mode: lightweight

## Work Units
- [~] WU-1 — Step A

## Next
WU-99 — Nonexistent step
`
    );

    const res = await validateWorkLedger(dir);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e: string) => e.includes("Next points to unknown Work Unit")));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("validator: missing EV reference fails", async () => {
  const base = await mkdtemp(join(tmpdir(), "andmar-ledger-test-"));
  const dir = join(base, "missing-ev");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "WORK.md"),
      `# Work
Work ID: missing-ev
Status: active
Mode: lightweight

## Work Units
- [~] WU-1 — Step A
  - Evidence: EV-1

## Evidence
- EV-2: Different evidence

## Next
WU-1
`
    );

    const res = await validateWorkLedger(dir);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e: string) => e.includes('unknown evidence "EV-1"')));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("validator: unknown requirement reference from WU fails", async () => {
  const base = await mkdtemp(join(tmpdir(), "andmar-ledger-test-"));
  const dir = join(base, "unknown-req");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "WORK.md"),
      `# Work
Work ID: unknown-req
Status: active
Mode: lightweight

## Requirements
- REQ-1: Declared requirement

## Work Units
- [~] WU-1 — Step A
  - Requirements: REQ-1, REQ-2

## Next
WU-1
`
    );

    const res = await validateWorkLedger(dir);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e: string) => e.includes('unknown requirement "REQ-2"')));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("validator: work_id and folder name mismatch fails", async () => {
  const base = await mkdtemp(join(tmpdir(), "andmar-ledger-test-"));
  const dir = join(base, "actual-folder-name");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "WORK.md"),
      `# Work
Work ID: different-work-id
Status: active
Mode: lightweight

## Work Units
- [~] WU-1 — Step A

## Next
WU-1
`
    );

    const res = await validateWorkLedger(dir);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e: string) => e.includes('does not match work_id')));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("validator: valid blocked ledger passes", async () => {
  const base = await mkdtemp(join(tmpdir(), "andmar-ledger-test-"));
  const dir = join(base, "blocked-task");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "WORK.md"),
      `# Work
Work ID: blocked-task
Status: blocked
Mode: lightweight

## Requirements
- REQ-1: External integration

## Work Units
- [!] WU-1 — External integration blocked on API credentials
  - Requirements: REQ-1

## Blockers
Waiting for third-party API key
`
    );

    const res = await validateWorkLedger(dir);
    assert.equal(res.valid, true);
    assert.equal(res.status, "blocked");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});


test("validator: rejects Intake mode enrich as a Work Ledger mode", async () => {
  const base = await mkdtemp(join(tmpdir(), "andmar-ledger-test-"));
  const dir = join(base, "wrong-enrich-mode");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "WORK.md"),
      `# Work
Work ID: wrong-enrich-mode
Status: active
Mode: enrich

## Work Units
- [~] WU-1 — Do work

## Next
WU-1
`
    );

    const res = await validateWorkLedger(dir);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e: string) => e.includes('Invalid mode "enrich"')));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("validator: rejects Intake mode structure as a Work Ledger mode", async () => {
  const base = await mkdtemp(join(tmpdir(), "andmar-ledger-test-"));
  const dir = join(base, "wrong-structure-mode");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "WORK.md"),
      `# Work
Work ID: wrong-structure-mode
Status: active
Mode: structure

## Work Units
- [~] WU-1 — Do work

## Next
WU-1
`
    );

    const res = await validateWorkLedger(dir);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e: string) => e.includes('Invalid mode "structure"')));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
