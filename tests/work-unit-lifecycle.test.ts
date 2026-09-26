import test from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runWorkUnitLifecycle } from "../scripts/work-ledger-lifecycle.mjs"
import { validateWorkLedger } from "../scripts/validate-work-ledger.mjs"

async function makeLightweight(name: string, body?: string) {
  const base = await mkdtemp(join(tmpdir(), "andmar-wu-life-"))
  const dir = join(base, ".andmar", "work", name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "WORK.md"), body ?? `# Work — ${name}

Work ID: ${name}
Status: active
Mode: lightweight

## Requirements
- REQ-1: First outcome
- REQ-2: Second outcome

## Work Units
- [~] WU-1 — First outcome
  - Requirements: REQ-1
- [ ] WU-2 — Second outcome
  - Requirements: REQ-2

## Evidence
- EV-1: first verification passed
- EV-2: second verification passed

## Next
WU-1 — First outcome
`)
  return { base, dir }
}

async function readWork(dir: string) {
  return readFile(join(dir, "WORK.md"), "utf8")
}

test("work-unit lifecycle: status reports portable unit state without mutation", async () => {
  const { base, dir } = await makeLightweight("status-task")
  try {
    const before = await readWork(dir)
    const result = await runWorkUnitLifecycle("status", dir, undefined)
    assert.equal(result.changed, false)
    assert.equal(result.active, "WU-1")
    assert.deepEqual(result.pending, ["WU-2"])
    assert.deepEqual(result.done, [])
    assert.equal(await readWork(dir), before)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("work-unit lifecycle: activate moves pending to active and updates Next", async () => {
  const { base, dir } = await makeLightweight("activate-task", `# Work
Work ID: activate-task
Status: active
Mode: lightweight

## Work Units
- [ ] WU-1 — First outcome
- [ ] WU-2 — Second outcome

## Next
WU-1 — pending
`)
  try {
    const result = await runWorkUnitLifecycle("activate", dir, "WU-1")
    assert.equal(result.active, "WU-1")
    const work = await readWork(dir)
    assert.match(work, /- \[~\] WU-1/)
    assert.match(work, /## Next\n\nWU-1 — active outcome/)
    assert.match(work, /WU-1: pending → active/)
    assert.equal((await validateWorkLedger(dir)).valid, true)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("work-unit lifecycle: activate rejects when another unit is active", async () => {
  const { base, dir } = await makeLightweight("activate-conflict")
  try {
    await assert.rejects(
      () => runWorkUnitLifecycle("activate", dir, "WU-2"),
      /already active/,
    )
    assert.match(await readWork(dir), /- \[~\] WU-1/)
    assert.match(await readWork(dir), /- \[ \] WU-2/)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("work-unit lifecycle: complete requires evidence and leaves file unchanged on rejection", async () => {
  const { base, dir } = await makeLightweight("complete-no-evidence")
  try {
    const before = await readWork(dir)
    await assert.rejects(
      () => runWorkUnitLifecycle("complete", dir, "WU-1"),
      /requires --evidence/,
    )
    assert.equal(await readWork(dir), before)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("work-unit lifecycle: complete attaches evidence and atomically advances next pending unit", async () => {
  const { base, dir } = await makeLightweight("complete-advance")
  try {
    const result = await runWorkUnitLifecycle("complete", dir, "WU-1", { evidence: "EV-1" })
    assert.equal(result.active, "WU-2")
    assert.deepEqual(result.done, ["WU-1"])
    const work = await readWork(dir)
    assert.match(work, /- \[x\] WU-1/)
    assert.match(work, /- Evidence: EV-1/)
    assert.match(work, /- \[~\] WU-2/)
    assert.match(work, /## Next\n\nWU-2 — active outcome/)
    assert.equal((await validateWorkLedger(dir)).valid, true)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})



test("work-unit lifecycle: complete honors explicit pending --next selection", async () => {
  const { base, dir } = await makeLightweight("explicit-next", `# Work
Work ID: explicit-next
Status: active
Mode: lightweight

## Work Units
- [~] WU-1 — First
- [ ] WU-2 — Second
- [ ] WU-3 — Third

## Evidence
- EV-1: first verified

## Next
WU-1 — First
`)
  try {
    const result = await runWorkUnitLifecycle("complete", dir, "WU-1", { evidence: "EV-1", next: "WU-3" })
    assert.equal(result.active, "WU-3")
    assert.deepEqual(result.pending, ["WU-2"])
    const work = await readWork(dir)
    assert.match(work, /- \[ \] WU-2/)
    assert.match(work, /- \[~\] WU-3/)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("work-unit lifecycle: complete rejects unknown evidence and rolls back", async () => {
  const { base, dir } = await makeLightweight("complete-bad-evidence")
  try {
    const before = await readWork(dir)
    await assert.rejects(
      () => runWorkUnitLifecycle("complete", dir, "WU-1", { evidence: "EV-99" }),
      /rolled back.*unknown evidence|unknown evidence/s,
    )
    assert.equal(await readWork(dir), before)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("work-unit lifecycle: completing final unit leaves no active unit and prepares completion", async () => {
  const { base, dir } = await makeLightweight("complete-final", `# Work
Work ID: complete-final
Status: active
Mode: lightweight

## Requirements
- REQ-1: Only outcome

## Work Units
- [~] WU-1 — Only outcome
  - Requirements: REQ-1

## Evidence
- EV-1: verification passed

## Next
WU-1 — Only outcome
`)
  try {
    const result = await runWorkUnitLifecycle("complete", dir, "WU-1", { evidence: "EV-1" })
    assert.equal(result.active, null)
    assert.deepEqual(result.done, ["WU-1"])
    const work = await readWork(dir)
    assert.match(work, /all work units complete; prepare final verification/)
    assert.equal((await validateWorkLedger(dir)).valid, true)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("work-unit lifecycle: block requires reason and records blocker deterministically", async () => {
  const { base, dir } = await makeLightweight("block-task")
  try {
    await assert.rejects(() => runWorkUnitLifecycle("block", dir, "WU-1"), /requires --reason/)
    const result = await runWorkUnitLifecycle("block", dir, "WU-1", { reason: "waiting for credentials" })
    assert.equal(result.status, "blocked")
    assert.deepEqual(result.blocked, ["WU-1"])
    const work = await readWork(dir)
    assert.match(work, /- \[!\] WU-1/)
    assert.match(work, /- Blocker: waiting for credentials/)
    assert.match(work, /Status: blocked/)
    assert.equal((await validateWorkLedger(dir)).valid, true)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("work-unit lifecycle: resume explicitly moves blocked to active and clears blocker field", async () => {
  const { base, dir } = await makeLightweight("resume-task")
  try {
    await runWorkUnitLifecycle("block", dir, "WU-1", { reason: "provider down" })
    await assert.rejects(() => runWorkUnitLifecycle("resume", dir, "WU-1"), /requires --reason/)
    const result = await runWorkUnitLifecycle("resume", dir, "WU-1", { reason: "provider recovered" })
    assert.equal(result.active, "WU-1")
    const work = await readWork(dir)
    assert.match(work, /- \[~\] WU-1/)
    assert.doesNotMatch(work, /- Blocker:/)
    assert.match(work, /blocked → active — provider recovered/)
    assert.equal((await validateWorkLedger(dir)).valid, true)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("work-unit lifecycle: reopen is explicit, requires reason, and clears old unit evidence pointer", async () => {
  const { base, dir } = await makeLightweight("reopen-task", `# Work
Work ID: reopen-task
Status: active
Mode: lightweight

## Requirements
- REQ-1: Outcome

## Work Units
- [x] WU-1 — Outcome
  - Requirements: REQ-1
  - Evidence: EV-1

## Evidence
- EV-1: old verification

## Next
WU-1 — all work units complete; prepare final verification
`)
  try {
    await assert.rejects(() => runWorkUnitLifecycle("reopen", dir, "WU-1"), /requires --reason/)
    const result = await runWorkUnitLifecycle("reopen", dir, "WU-1", { reason: "source change invalidated outcome" })
    assert.equal(result.active, "WU-1")
    const work = await readWork(dir)
    assert.match(work, /- \[~\] WU-1/)
    assert.doesNotMatch(work, /\s+- Evidence: EV-1/)
    assert.match(work, /done → active — source change invalidated outcome/)
    assert.equal((await validateWorkLedger(dir)).valid, true)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("work-unit lifecycle: reopen rejects while another unit is active", async () => {
  const { base, dir } = await makeLightweight("reopen-conflict", `# Work
Work ID: reopen-conflict
Status: active
Mode: lightweight

## Work Units
- [x] WU-1 — Done
  - Evidence: EV-1
- [~] WU-2 — Active

## Evidence
- EV-1: prior proof

## Next
WU-2 — Active
`)
  try {
    await assert.rejects(
      () => runWorkUnitLifecycle("reopen", dir, "WU-1", { reason: "needs rework" }),
      /already active/,
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("work-unit lifecycle: completed ledger is immutable", async () => {
  const { base, dir } = await makeLightweight("sealed-task", `# Work
Work ID: sealed-task
Status: completed
Mode: lightweight

## Work Units
- [x] WU-1 — Done
  - Evidence: EV-1

## Evidence
- EV-1: passed

## Next
WU-1 — completed
`)
  try {
    await assert.rejects(
      () => runWorkUnitLifecycle("reopen", dir, "WU-1", { reason: "change" }),
      /Completed Work Ledger cannot be mutated/,
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
