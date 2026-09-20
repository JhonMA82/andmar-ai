import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

const root = new URL("../", import.meta.url)
const rootPath = root.pathname
const failures = []

const capabilityRoot = join(rootPath, "src/capabilities")
const capabilityDirs = (await readdir(capabilityRoot, { withFileTypes: true })).filter((d) => d.isDirectory())
for (const dir of capabilityDirs) {
  const file = join(capabilityRoot, dir.name, "index.ts")
  let content
  try {
    content = await readFile(file, "utf8")
  } catch {
    failures.push(`Capability ${dir.name} is missing index.ts`)
    continue
  }
  if (/capabilities\/[a-zA-Z0-9_-]+/.test(content)) {
    failures.push(`Capability ${dir.name} imports another capability; use a core contract instead.`)
  }
}

for (const name of await readdir(join(rootPath, "src/core"))) {
  if (!name.endsWith(".ts")) continue
  const content = await readFile(join(rootPath, "src/core", name), "utf8")
  if (content.includes("@opencode/plugin")) failures.push(`Core file ${name} depends directly on @opencode/plugin.`)
  if (content.includes("/capabilities/")) failures.push(`Core file ${name} depends on a capability.`)
}

const pkg = JSON.parse(await readFile(join(rootPath, "package.json"), "utf8"))
const changelog = await readFile(join(rootPath, "CHANGELOG.md"), "utf8")
if (!changelog.includes(`## [${pkg.version}]`)) {
  failures.push(`CHANGELOG.md has no entry for package version ${pkg.version}.`)
}

if (failures.length) {
  console.error("Architecture check failed:\n- " + failures.join("\n- "))
  process.exit(1)
}
console.log(`Architecture check passed (${capabilityDirs.length} capabilities, version ${pkg.version}).`)
