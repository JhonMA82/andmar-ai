import { readdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export async function sourceFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(path))
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path)
  }
  return files.sort()
}

// One serializer for generation and read-only architecture verification.
export async function capabilityArtifacts(root) {
  const capabilitiesDir = join(root, "src/capabilities")
  const entries = (await readdir(capabilitiesDir, { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  const safeName = name => name.replace(/[^a-zA-Z0-9_$]/g, "_")
  const imports = entries.map(name => `import ${safeName(name)} from "../capabilities/${name}/index.ts"`).join("\n")
  const content = `// GENERATED FILE. Run \`bun run generate\`. Do not edit manually.\n${imports}\n\nexport const capabilities = [${entries.map(safeName).join(", ")}] as const\n`
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
  const rows = []
  for (const name of entries) {
    const source = await readFile(join(capabilitiesDir, name, "index.ts"), "utf8")
    const allSources = (await Promise.all((await sourceFiles(join(capabilitiesDir, name))).map(file => readFile(file, "utf8")))).join("\n")
    rows.push({
      id: source.match(/^\s*id:\s*"([^"]+)"/m)?.[1] ?? name,
      version: source.match(/^\s*version:\s*(\d+)/m)?.[1] ?? "?",
      description: source.match(/^\s*description:\s*"([^"]+)"/m)?.[1] ?? "",
      tools: [...allSources.matchAll(/editor\.add\(\{\s*name:\s*"([^"]+)"/g)].map(match => `andmar_${match[1]}`),
    })
  }
  const table = rows.map(row => `| \`${row.id}\` | ${row.version} | ${row.description} | ${row.tools.map(tool => `\`${tool}\``).join("<br>") || "—"} |`).join("\n")
  const index = `# Capabilities Index

<!-- GENERATED FILE. Run \`bun run generate\`. Do not edit manually. -->

Objective index derived from capability declarations and local tool registrations.
For purpose, boundaries, state ownership and failure behavior see the canonical
[capabilities guide](ANDMAR-AI-CAPABILITIES.md) and the
[capability contract](CAPABILITY-CONTRACT.md).

| Capability | Version | Description | Tools exposed |
|---|---|---|---|
${table}

_Source of truth for registration: \`src/generated/capabilities.ts\`._
`
  return { rows, version: pkg.version, files: new Map([
    ["src/generated/capabilities.ts", content],
    ["src/generated/version.ts", `// GENERATED FROM package.json. Do not edit manually.\nexport const HARNESS_VERSION = ${JSON.stringify(pkg.version)} as const\n`],
    ["docs/CAPABILITIES.md", index],
  ]) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const artifacts = await capabilityArtifacts(root)
  for (const [path, content] of artifacts.files) await writeFile(join(root, path), content)
  console.log(`Generated ${join(root, "src/generated")} for ${artifacts.rows.length} capabilities; version ${artifacts.version}.`)
  console.log(`Generated ${join(root, "docs/CAPABILITIES.md")} (${artifacts.rows.length} capabilities).`)
}
