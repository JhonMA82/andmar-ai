import test from "node:test"
import assert from "node:assert/strict"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

const root = new URL("..", import.meta.url).pathname

test("Engram setup delegates ownership to official engram setup opencode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "andmar-engram-setup-"))
  try {
    const log = join(dir, "calls.log")
    const fake = join(dir, "engram")
    await writeFile(fake, `#!/bin/sh\necho "$@" >> "${log}"\nif [ "$1" = "version" ]; then echo "engram v2.2.1"; exit 0; fi\nif [ "$1" = "setup" ] && [ "$2" = "opencode" ]; then echo "configured"; exit 0; fi\nexit 2\n`)
    await chmod(fake, 0o755)
    const run = spawnSync(process.execPath, [join(root, "scripts", "setup-engram.mjs")], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
    })
    assert.equal(run.status, 0, run.stderr || run.stdout)
    assert.match(run.stdout, /delegated to `engram setup opencode`/i)
    assert.deepEqual((await readFile(log, "utf8")).trim().split("\n"), ["version", "setup opencode"])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
