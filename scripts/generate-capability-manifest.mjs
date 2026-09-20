import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const root = new URL("../", import.meta.url)
const capabilitiesDir = new URL("../src/capabilities/", import.meta.url)
const generatedFile = new URL("../src/generated/capabilities.ts", import.meta.url)
const versionFile = new URL("../src/generated/version.ts", import.meta.url)
const packageFile = new URL("../package.json", import.meta.url)

const entries = (await readdir(capabilitiesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const imports = entries.map((name) => `import ${safeName(name)} from "../capabilities/${name}/index.ts"`).join("\n")
const list = entries.map(safeName).join(", ")
const content = `// GENERATED FILE. Run \`npm run generate\`. Do not edit manually.\n${imports}\n\nexport const capabilities = [${list}] as const\n`
await writeFile(generatedFile, content)

const pkg = JSON.parse(await readFile(packageFile, "utf8"))
await writeFile(versionFile, `// GENERATED FROM package.json. Do not edit manually.\nexport const HARNESS_VERSION = ${JSON.stringify(pkg.version)} as const\n`)

console.log(`Generated ${join(root.pathname, "src/generated")} for ${entries.length} capabilities; version ${pkg.version}.`)

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9_$]/g, "_")
}
