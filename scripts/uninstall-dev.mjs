import { lstat, readFile, readlink, realpath, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const configDir = resolve(process.env.OPENCODE_CONFIG_DIR || join(homedir(), ".config", "opencode"))
const pluginPath = join(configDir, "plugins", "andmar-ai")
const agentPath = join(configDir, "agents", "andmar.md")
const sourceAgent = join(root, "assets", "agents", "andmar.md")

try {
  const stat = await lstat(pluginPath)
  if (!stat.isSymbolicLink()) {
    console.warn(`Kept ${pluginPath}: it is not a symlink owned by the dev installer.`)
  } else {
    const target = resolve(dirname(pluginPath), await readlink(pluginPath))
    const [actualTarget, actualRoot] = await Promise.all([
      realpath(target).catch(() => target),
      realpath(root).catch(() => root),
    ])
    if (actualTarget === actualRoot) {
      await rm(pluginPath)
      console.log(`Removed plugin link: ${pluginPath}`)
    } else {
      console.warn(`Kept ${pluginPath}: it points to ${actualTarget}.`)
    }
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error
}

try {
  const [installed, source] = await Promise.all([
    readFile(agentPath, "utf8"),
    readFile(sourceAgent, "utf8"),
  ])
  if (installed === source) {
    await rm(agentPath)
    console.log(`Removed agent: ${agentPath}`)
  } else {
    console.warn(`Kept ${agentPath}: it differs from the AndMar AI source agent.`)
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error
}
