import { spawnSync } from "node:child_process"

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
}

const version = run("engram", ["version"])
if (version.error?.code === "ENOENT") {
  console.error("Engram is not installed or not in PATH. Install Engram first, then rerun: npm run engram:setup")
  process.exit(1)
}
if (version.status !== 0) {
  console.error((version.stderr || version.stdout || `engram version exited ${version.status}`).trim())
  process.exit(1)
}

const setup = run("engram", ["setup", "opencode"])
if (setup.status !== 0) {
  console.error((setup.stderr || setup.stdout || `engram setup opencode exited ${setup.status}`).trim())
  process.exit(1)
}

console.log(`Engram integration configured for OpenCode.`)
console.log(`- version: ${(version.stdout || version.stderr).trim()}`)
console.log(`- setup: delegated to \`engram setup opencode\` (agent MCP profile)`)
console.log("")
console.log("Optional per-project canonical identity:")
console.log("  cd <project> && engram init <canonical-project-name>")
console.log("")
console.log("Diagnostics remain owned by Engram:")
console.log("  engram doctor --json")
console.log("  engram test --quick --json")
