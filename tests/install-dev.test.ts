import test from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises"
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


test("installed AndMar helpers execute from an unrelated consumer repository", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "andmar-install-"))
  const projectDir = await mkdtemp(join(tmpdir(), "andmar-consumer-"))
  try {
    const install = run("scripts/install-dev.mjs", configDir)
    assert.equal(install.status, 0, install.stderr || install.stdout)

    const pluginPath = join(configDir, "plugins", "andmar-ai")
    const revisionHelper = join(pluginPath, "scripts", "working-state-revision.mjs")
    const validatorHelper = join(pluginPath, "scripts", "validate-work-ledger.mjs")
    const lifecycleHelper = join(pluginPath, "scripts", "work-ledger-lifecycle.mjs")

    const git = (...args: string[]) => spawnSync("git", args, { cwd: projectDir, encoding: "utf8" })
    assert.equal(git("init").status, 0)
    assert.equal(git("config", "user.email", "andmar@example.test").status, 0)
    assert.equal(git("config", "user.name", "AndMar Test").status, 0)
    await mkdir(join(projectDir, "src"), { recursive: true })
    await writeFile(join(projectDir, "src", "index.ts"), "export const value = 1\n")
    assert.equal(git("add", ".").status, 0)
    assert.equal(git("commit", "-m", "baseline").status, 0)

    const helperEnv = { ...process.env, OPENCODE_CONFIG_DIR: configDir }
    const before = spawnSync(node, [revisionHelper], { cwd: projectDir, env: helperEnv, encoding: "utf8" })
    assert.equal(before.status, 0, before.stderr || before.stdout)
    const revision = before.stdout.trim()
    assert.match(revision, /^[a-f0-9]{64}$/)

    const ledgerDir = join(projectDir, ".andmar", "work", "consumer-task")
    await mkdir(ledgerDir, { recursive: true })
    await writeFile(
      join(ledgerDir, "WORK.md"),
      `# Work\nWork ID: consumer-task\nStatus: active\nMode: lightweight\n\n## Work Units\n- [~] WU-1 — Continue\n\n## Evidence\n- EV-1: consumer smoke passed\n\n## Next\nWU-1\n`,
    )

    const after = spawnSync(node, [revisionHelper], { cwd: projectDir, env: helperEnv, encoding: "utf8" })
    assert.equal(after.status, 0, after.stderr || after.stdout)
    assert.equal(after.stdout.trim(), revision)

    const validation = spawnSync(node, [validatorHelper, ".andmar/work/consumer-task"], {
      cwd: projectDir,
      env: helperEnv,
      encoding: "utf8",
    })
    assert.equal(validation.status, 0, validation.stderr || validation.stdout)
    const result = JSON.parse(validation.stdout)
    assert.equal(result.valid, true)
    assert.equal(result.mode, "lightweight")

    const transition = spawnSync(node, [lifecycleHelper, "complete", ".andmar/work/consumer-task", "WU-1", "--evidence", "EV-1"], {
      cwd: projectDir,
      env: helperEnv,
      encoding: "utf8",
    })
    assert.equal(transition.status, 0, transition.stderr || transition.stdout)
    const lifecycleResult = JSON.parse(transition.stdout)
    assert.equal(lifecycleResult.ok, true)
    assert.equal(lifecycleResult.active, null)
    assert.deepEqual(lifecycleResult.done, ["WU-1"])

    const afterLifecycle = spawnSync(node, [revisionHelper], { cwd: projectDir, env: helperEnv, encoding: "utf8" })
    assert.equal(afterLifecycle.status, 0, afterLifecycle.stderr || afterLifecycle.stdout)
    assert.equal(afterLifecycle.stdout.trim(), revision)
  } finally {
    await rm(configDir, { recursive: true, force: true })
    await rm(projectDir, { recursive: true, force: true })
  }
})
