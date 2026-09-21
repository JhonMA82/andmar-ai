import { lstat, readFile, readlink, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const configDir = resolve(process.env.OPENCODE_CONFIG_DIR || join(homedir(), ".config", "opencode"))
const pluginPath = join(configDir, "plugins", "andmar-ai")
const agentPath = join(configDir, "agents", "andmar.md")
const sourceAgent = join(root, "assets", "agents", "andmar.md")
const checks = []

function record(name, ok, detail) {
  checks.push({ name, ok, detail })
}

const versionResult = spawnSync(process.env.OPENCODE_BIN || "opencode", ["--version"], { encoding: "utf8" })
if (versionResult.error?.code === "ENOENT") {
  record("opencode", false, "binary not found in PATH")
} else if (versionResult.status !== 0) {
  record("opencode", false, (versionResult.stderr || versionResult.stdout || `exit ${versionResult.status}`).trim())
} else {
  const raw = (versionResult.stdout || versionResult.stderr || "").trim()
  const match = raw.match(/v?(\d+)\.(\d+)\.(\d+)/i)
  if (!match) record("opencode", false, `could not parse version from: ${raw}`)
  else record("opencode", Number(match[1]) >= 2, raw)
}

try {
  const stat = await lstat(pluginPath)
  if (!stat.isSymbolicLink()) {
    record("plugin", false, `${pluginPath} exists but is not the AndMar dev symlink`)
  } else {
    const target = resolve(dirname(pluginPath), await readlink(pluginPath))
    const [actualTarget, actualRoot] = await Promise.all([
      realpath(target).catch(() => target),
      realpath(root).catch(() => root),
    ])
    record("plugin", actualTarget === actualRoot, `${pluginPath} -> ${actualTarget}`)
  }
} catch (error) {
  record("plugin", false, error?.code === "ENOENT" ? `${pluginPath} is not installed` : String(error))
}

try {
  const [installed, source] = await Promise.all([readFile(agentPath, "utf8"), readFile(sourceAgent, "utf8")])
  record("agent", installed === source, installed === source ? agentPath : `${agentPath} differs from this checkout`)
} catch (error) {
  record("agent", false, error?.code === "ENOENT" ? `${agentPath} is not installed` : String(error))
}

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
const pluginDependency = pkg.dependencies?.["@opencode/plugin"]
record(
  "plugin-api",
  typeof pluginDependency === "string" && /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(pluginDependency),
  `@opencode/plugin=${pluginDependency ?? "missing"}`,
)

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`)
}

if (checks.some((check) => !check.ok)) {
  console.error("\nAndMar AI doctor found blockers. Fix them before treating a runtime test as valid.")
  process.exit(1)
}

console.log("\nAndMar AI dev environment is ready for a real OpenCode V2 test.")
