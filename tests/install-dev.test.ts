import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const root = resolve(new URL("..", import.meta.url).pathname)
const node = process.execPath

function run(script: string, configDir: string) {
  return spawnSync(node, [join(root, script)], {
    cwd: root,
    env: { ...process.env, OPENCODE_CONFIG_DIR: configDir },
    encoding: "utf8",
  })
}

test("dev installer is idempotent and refuses to overwrite a modified global agent", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "andmar-install-"))
  try {
    const first = run("scripts/install-dev.mjs", configDir)
    assert.equal(first.status, 0, first.stderr || first.stdout)

    const pluginPath = join(configDir, "plugins", "andmar-ai")
    const agentPath = join(configDir, "agents", "andmar.md")
    assert.equal(resolve(join(configDir, "plugins"), await readlink(pluginPath)), root)
    assert.match(await readFile(agentPath, "utf8"), /^---\n[\s\S]*?mode:\s*primary/m)

    const second = run("scripts/install-dev.mjs", configDir)
    assert.equal(second.status, 0, second.stderr || second.stdout)
    assert.match(second.stdout, /already linked/)
    assert.match(second.stdout, /already installed/)

    await writeFile(agentPath, "user-customized-agent\n")
    const conflicting = run("scripts/install-dev.mjs", configDir)
    assert.notEqual(conflicting.status, 0)
    assert.match(conflicting.stderr + conflicting.stdout, /Refusing to overwrite/)

    const uninstall = run("scripts/uninstall-dev.mjs", configDir)
    assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout)
    assert.equal(await readFile(agentPath, "utf8"), "user-customized-agent\n")
  } finally {
    await rm(configDir, { recursive: true, force: true })
  }
})
