import { cp, lstat, mkdir, readFile, readlink, realpath, symlink } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const configDir = resolve(process.env.OPENCODE_CONFIG_DIR || join(homedir(), ".config", "opencode"))
const pluginsDir = join(configDir, "plugins")
const agentsDir = join(configDir, "agents")
const pluginPath = join(pluginsDir, "andmar-ai")
const agentPath = join(agentsDir, "andmar.md")
const sourceAgent = join(root, "assets", "agents", "andmar.md")

await mkdir(pluginsDir, { recursive: true })
await mkdir(agentsDir, { recursive: true })

async function installPluginLink() {
  try {
    const stat = await lstat(pluginPath)
    if (!stat.isSymbolicLink()) {
      throw new Error(`${pluginPath} already exists and is not a symlink. Refusing to overwrite it.`)
    }
    const target = resolve(dirname(pluginPath), await readlink(pluginPath))
    const [actualTarget, actualRoot] = await Promise.all([
      realpath(target).catch(() => target),
      realpath(root).catch(() => root),
    ])
    if (actualTarget !== actualRoot) {
      throw new Error(`${pluginPath} already points to ${actualTarget}. Refusing to replace it.`)
    }
    return "already linked"
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }

  await symlink(root, pluginPath, process.platform === "win32" ? "junction" : "dir")
  return "linked"
}

async function installAgent() {
  const source = await readFile(sourceAgent, "utf8")
  try {
    const installed = await readFile(agentPath, "utf8")
    if (installed === source) return "already installed"
    throw new Error(`${agentPath} already exists and differs from the AndMar AI agent. Refusing to overwrite it.`)
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  await cp(sourceAgent, agentPath)
  return "installed"
}

const pluginState = await installPluginLink()
const agentState = await installAgent()

console.log(`AndMar AI dev install ready.`)
console.log(`- plugin: ${pluginPath} -> ${root} (${pluginState})`)
console.log(`- agent:  ${agentPath} (${agentState})`)
console.log("")
console.log("Restart OpenCode if it is already running:")
console.log("  opencode service restart")
console.log("")
console.log("Then start OpenCode in a project and use Tab to select the AndMar primary agent.")
