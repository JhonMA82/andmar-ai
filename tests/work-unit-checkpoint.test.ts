import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runWorkUnitCheckpoint } from "../scripts/work-unit-checkpoint.mjs"
import { computeWorkingStateRevision } from "../scripts/working-state-revision.mjs"
import { runWorkUnitLifecycle } from "../scripts/work-ledger-lifecycle.mjs"
import { validateWorkLedger } from "../scripts/validate-work-ledger.mjs"

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

async function makeRepo(name: string) {
  const root = await mkdtemp(join(tmpdir(), "andmar-checkpoint-"))
  git(root, "init")
  git(root, "config", "user.email", "andmar@example.test")
  git(root, "config", "user.name", "AndMar Test")
  await mkdir(join(root, "src"), { recursive: true })
  await writeFile(join(root, "src", "index.ts"), "export const value = 1\n")
  git(root, "add", ".")
  git(root, "commit", "-m", "baseline")

  const dir = join(root, ".andmar", "work", name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "WORK.md"), `# Work — ${name}

Work ID: ${name}
Status: active
Mode: lightweight

## Requirements
- REQ-1: Change value
- REQ-2: Follow-up

## Work Units
- [~] WU-1 — Change exported value
  - Requirements: REQ-1
  - Checkpoint: none
- [ ] WU-2 — Follow-up outcome
  - Requirements: REQ-2
  - Checkpoint: none

## Evidence
- EV-1: focused verification passed

## Next
WU-1 — active outcome
`)
  return { root, dir }
}

async function finishWu1(root: string, dir: string) {
  await writeFile(join(root, "src", "index.ts"), "export const value = 2\n")
  await runWorkUnitLifecycle("complete", dir, "WU-1", { evidence: "EV-1" })
  return computeWorkingStateRevision(root)
}

function checkpointCommit(root: string, message: string) {
  git(root, "add", "src", ".andmar/work")
  execFileSync("git", ["commit", "-m", message], { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
  return git(root, "rev-parse", "HEAD")
}

test("work-unit checkpoint: prepare requires done unit, evidence, and exact verified revision", async () => {
  const { root, dir } = await makeRepo("prepare-ready")
  try {
    await assert.rejects(
      () => runWorkUnitCheckpoint("prepare", dir, "WU-1", { revision: "0".repeat(64) }),
      /requires done Work Unit/,
    )

    const revision = await finishWu1(root, dir)
    await assert.rejects(
      () => runWorkUnitCheckpoint("prepare", dir, "WU-1", { revision: "0".repeat(64) }),
      /Verified revision is stale/,
    )

    const prepared = await runWorkUnitCheckpoint("prepare", dir, "WU-1", { revision: revision.revision })
    assert.equal(prepared.ready, true)
    assert.equal(prepared.unit, "WU-1")
    assert.deepEqual(prepared.changedPaths, ["src/index.ts"])
    assert.match(prepared.commitMessage, /^WU-1: Change exported value/m)
    assert.match(prepared.commitMessage, /Work-ID: prepare-ready/)
    assert.match(prepared.commitMessage, /Work-Unit: WU-1/)
    assert.match(prepared.commitMessage, new RegExp(`Verified-Revision: ${revision.revision}`))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("work-unit checkpoint: prepare skips checkpoint when only ledger metadata changed", async () => {
  const { root, dir } = await makeRepo("metadata-only")
  try {
    await runWorkUnitLifecycle("complete", dir, "WU-1", { evidence: "EV-1" })
    const prepared = await runWorkUnitCheckpoint("prepare", dir, "WU-1")
    assert.equal(prepared.ready, false)
    assert.equal(prepared.reason, "no-product-changes")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("work-unit checkpoint: record accepts current native Git commit with deterministic trailers", async () => {
  const { root, dir } = await makeRepo("record-good")
  try {
    const revision = await finishWu1(root, dir)
    const prepared = await runWorkUnitCheckpoint("prepare", dir, "WU-1", { revision: revision.revision })
    const commit = checkpointCommit(root, prepared.commitMessage)

    const recorded = await runWorkUnitCheckpoint("record", dir, "WU-1", { commit })
    assert.equal(recorded.changed, true)
    assert.equal(recorded.checkpoint, commit)
    assert.deepEqual(recorded.productPaths, ["src/index.ts"])

    const work = await readFile(join(dir, "WORK.md"), "utf8")
    assert.match(work, new RegExp(`Checkpoint: ${commit}`))
    assert.match(work, /WU-1: checkpoint [a-f0-9]{12} \(verified [a-f0-9]{12}\)/)
    assert.equal((await validateWorkLedger(dir)).valid, true)

    const second = await runWorkUnitCheckpoint("record", dir, "WU-1", { commit })
    assert.equal(second.changed, false)
    assert.equal(second.alreadyRecorded, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("work-unit checkpoint: record rejects wrong Work Unit trailer and non-HEAD commits", async () => {
  const { root, dir } = await makeRepo("record-guards")
  try {
    const revision = await finishWu1(root, dir)
    const prepared = await runWorkUnitCheckpoint("prepare", dir, "WU-1", { revision: revision.revision })
    const badMessage = prepared.commitMessage.replace("Work-Unit: WU-1", "Work-Unit: WU-2")
    const badCommit = checkpointCommit(root, badMessage)

    await assert.rejects(
      () => runWorkUnitCheckpoint("record", dir, "WU-1", { commit: badCommit }),
      /Work-Unit trailer must equal WU-1/,
    )

    await writeFile(join(root, "src", "next.ts"), "export const next = true\n")
    git(root, "add", "src/next.ts")
    git(root, "commit", "-m", "later commit")
    await assert.rejects(
      () => runWorkUnitCheckpoint("record", dir, "WU-1", { commit: badCommit }),
      /current HEAD/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("work-unit checkpoint: reopening a done unit clears stale checkpoint metadata", async () => {
  const { root, dir } = await makeRepo("reopen-clears")
  try {
    const workPath = join(dir, "WORK.md")
    const singleUnit = (await readFile(workPath, "utf8"))
      .replace("- REQ-2: Follow-up\n", "")
      .replace("- [ ] WU-2 — Follow-up outcome\n  - Requirements: REQ-2\n  - Checkpoint: none\n", "")
    await writeFile(workPath, singleUnit)
    const revision = await finishWu1(root, dir)
    const prepared = await runWorkUnitCheckpoint("prepare", dir, "WU-1", { revision: revision.revision })
    const commit = checkpointCommit(root, prepared.commitMessage)
    await runWorkUnitCheckpoint("record", dir, "WU-1", { commit })

    const reopened = await runWorkUnitLifecycle("reopen", dir, "WU-1", { reason: "regression found" })
    assert.equal(reopened.active, "WU-1")
    const work = await readFile(join(dir, "WORK.md"), "utf8")
    assert.doesNotMatch(work, /Checkpoint: [a-f0-9]{7,64}/i)
    assert.doesNotMatch(work, /Evidence: EV-1/)
    assert.equal((await validateWorkLedger(dir)).valid, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
