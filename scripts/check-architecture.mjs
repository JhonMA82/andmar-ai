import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

const root = new URL("../", import.meta.url)
const rootPath = root.pathname
const failures = []

const capabilityRoot = join(rootPath, "src/capabilities")
const capabilityDirs = (await readdir(capabilityRoot, { withFileTypes: true })).filter((d) => d.isDirectory())
const capabilitySources = new Map()
for (const dir of capabilityDirs) {
  const file = join(capabilityRoot, dir.name, "index.ts")
  let content
  try {
    content = await readFile(file, "utf8")
  } catch {
    failures.push(`Capability ${dir.name} is missing index.ts`)
    continue
  }
  capabilitySources.set(dir.name, content)
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

// Generated manifest must list exactly the capability directories.
try {
  const manifest = await readFile(join(rootPath, "src/generated/capabilities.ts"), "utf8")
  const imported = [...manifest.matchAll(/\.\.\/capabilities\/([A-Za-z0-9_-]+)\/index\.ts/g)].map((match) => match[1])
  for (const dir of capabilityDirs) {
    if (!imported.includes(dir.name)) failures.push(`Registered capability "${dir.name}" has no entry in src/generated/capabilities.ts; run \`bun run generate\`.`)
  }
  for (const name of imported) {
    if (!capabilityDirs.some((dir) => dir.name === name)) {
      failures.push(`Manifest references unknown capability "${name}" with no src/capabilities/${name}/ directory.`)
    }
  }
} catch {
  failures.push("src/generated/capabilities.ts is missing; run `bun run generate`.")
}

// Structural documentation sync (no semantic quality judgment):
// registered capability -> canonical documentation section exists,
// public tool -> exactly one owning capability, generated index is in sync.
let guide = ""
try {
  guide = await readFile(join(rootPath, "docs/ANDMAR-AI-CAPABILITIES.md"), "utf8")
} catch {
  failures.push("docs/ANDMAR-AI-CAPABILITIES.md is missing; it is the canonical per-capability reference.")
}
const seenTools = new Map()
for (const [dir, content] of capabilitySources) {
  const id = content.match(/^\s*id:\s*"([^"]+)"/m)?.[1] ?? dir
  if (guide !== "" && !guide.includes(`### \`${id}\``)) {
    failures.push(`Capability "${id}" has no \`### \`${id}\`\` section in docs/ANDMAR-AI-CAPABILITIES.md.`)
  }
  for (const match of content.matchAll(/editor\.add\(\{\s*name:\s*"([^"]+)"/g)) {
    const tool = `andmar_${match[1]}`
    if (seenTools.has(tool)) {
      failures.push(`Tool "${tool}" is registered by both "${seenTools.get(tool)}" and "${dir}"; tool names must have exactly one owning capability.`)
    } else {
      seenTools.set(tool, dir)
    }
  }
}
try {
  const index = await readFile(join(rootPath, "docs/CAPABILITIES.md"), "utf8")
  if (!index.includes("GENERATED FILE. Run `bun run generate`")) {
    failures.push("docs/CAPABILITIES.md is not the generated index; run `bun run generate` and do not edit it manually.")
  }
  for (const [dir] of capabilitySources) {
    if (!index.includes(`\`${dir}\``)) failures.push(`Generated docs/CAPABILITIES.md has no entry for capability "${dir}"; run \`bun run generate\`.`)
  }
  for (const [tool] of seenTools) {
    if (!index.includes(`\`${tool}\``)) failures.push(`Generated docs/CAPABILITIES.md has no entry for tool "${tool}"; run \`bun run generate\`.`)
  }
} catch {
  failures.push("docs/CAPABILITIES.md is missing; run `bun run generate`.")
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
console.log(`Architecture check passed (${capabilityDirs.length} capabilities, ${seenTools.size} tools, version ${pkg.version}).`)
