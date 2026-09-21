import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const root = new URL("../", import.meta.url)
const capabilitiesDir = new URL("../src/capabilities/", import.meta.url)
const generatedFile = new URL("../src/generated/capabilities.ts", import.meta.url)
const versionFile = new URL("../src/generated/version.ts", import.meta.url)
const packageFile = new URL("../package.json", import.meta.url)
const capabilitiesIndexFile = new URL("../docs/CAPABILITIES.md", import.meta.url)

const entries = (await readdir(capabilitiesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const imports = entries.map((name) => `import ${safeName(name)} from "../capabilities/${name}/index.ts"`).join("\n")
const list = entries.map(safeName).join(", ")
const content = `// GENERATED FILE. Run \`bun run generate\`. Do not edit manually.\n${imports}\n\nexport const capabilities = [${list}] as const\n`
await writeFile(generatedFile, content)

const pkg = JSON.parse(await readFile(packageFile, "utf8"))
await writeFile(versionFile, `// GENERATED FROM package.json. Do not edit manually.\nexport const HARNESS_VERSION = ${JSON.stringify(pkg.version)} as const\n`)

// Objective capability index: id, version, description and exposed tools are
// derived from the capability sources, never hand-written. Conceptual prose
// stays in docs/ANDMAR-AI-CAPABILITIES.md and per-topic docs.
const rows = []
for (const name of entries) {
  const source = await readFile(new URL(`../src/capabilities/${name}/index.ts`, import.meta.url), "utf8")
  const id = source.match(/^\s*id:\s*"([^"]+)"/m)?.[1] ?? name
  const version = source.match(/^\s*version:\s*(\d+)/m)?.[1] ?? "?"
  const description = source.match(/^\s*description:\s*"([^"]+)"/m)?.[1] ?? ""
  const tools = [...source.matchAll(/editor\.add\(\{\s*name:\s*"([^"]+)"/g)].map((match) => `andmar_${match[1]}`)
  rows.push({ id, version, description, tools })
}

const table = rows.map((row) => `| \`${row.id}\` | ${row.version} | ${row.description} | ${row.tools.map((tool) => `\`${tool}\``).join("<br>") || "—"} |`).join("\n")
const index = `# Capabilities Index

<!-- GENERATED FILE. Run \`bun run generate\`. Do not edit manually. -->

Objective index derived from \`src/capabilities/*/index.ts\`.
For purpose, boundaries, state ownership and failure behavior see the canonical
[capabilities guide](ANDMAR-AI-CAPABILITIES.md) and the
[capability contract](CAPABILITY-CONTRACT.md).

| Capability | Version | Description | Tools exposed |
|---|---|---|---|
${table}

_Source of truth for registration: \`src/generated/capabilities.ts\`._
`
await writeFile(capabilitiesIndexFile, index)

console.log(`Generated ${join(root.pathname, "src/generated")} for ${entries.length} capabilities; version ${pkg.version}.`)
console.log(`Generated ${join(root.pathname, "docs/CAPABILITIES.md")} (${rows.length} capabilities).`)

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9_$]/g, "_")
}
