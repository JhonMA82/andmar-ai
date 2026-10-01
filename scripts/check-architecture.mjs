import { readdir, readFile } from "node:fs/promises"
import { basename, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { capabilityArtifacts } from "./generate-capability-manifest.mjs"

const isolated = path => /^(?:tests|test|fixtures)\//.test(path) || /\/(?:__tests__|__fixtures__)\//.test(path)
const history = path => path === "CHANGELOG.md" || /(?:^|\/)(?:history|historical|archive)(?:\/|$)/.test(path)
const legacy = /CompletionSeal|completionSealKey|contractStateToken|task-contract-completion|^(?:andmar[_-]?)?request[_-]?review$|ANDMAR_REVIEW_|review[_ -]?(?:rounds?|budgets?)|^testsPassed$/i
const coreDomain = /work[-_]?ledger|andmar-work|jev|engram|git[-_]?lifecycle|presentation|sidebar|renderer|tui|workflow/i

async function repositoryFiles(root, prefix = "") {
  const files = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    if ([".git", "node_modules", ".andmar", "dist", "coverage"].includes(entry.name)) continue
    const path = join(prefix, entry.name).replaceAll("\\", "/")
    if (entry.isDirectory()) files.push(...await repositoryFiles(root, path))
    else if (entry.isFile() || entry.isSymbolicLink()) files.push(path)
  }
  return files.sort()
}

// Syntax only: static imports/re-exports/import types and literal import/require.
// Reuse the existing TypeScript dependency to avoid matching examples/comments.
function inspectSource(path, content) {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true)
  const imports = [], symbols = []
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text)
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) imports.push(node.argument.literal.text)
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require") && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) imports.push(node.arguments[0].text)
    if (ts.isIdentifier(node) || ts.isStringLiteral(node)) symbols.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { imports, symbols }
}

export async function checkArchitecture(root) {
  root = resolve(root)
  const failures = []
  const files = await repositoryFiles(root)
  const canonical = "assets/agents/andmar.md"
  const agent = await readFile(join(root, canonical), "utf8").catch(() => "")
  if (!agent) failures.push(`Canonical primary agent ${canonical} is missing.`)
  for (const path of files) {
    if (!isolated(path) && /^(?:skills\.json|(?:skill|workflow|plugin)-registry\..+)$/.test(basename(path))) failures.push(`Proprietary registry source ${path} is forbidden.`)
    if (path !== canonical && !isolated(path) && !history(path) && path.endsWith(".md")) {
      if (basename(path) === "andmar.md" || agent && (await readFile(join(root, path), "utf8")).trim() === agent.trim()) failures.push(`Parallel primary agent source ${path}; use ${canonical}.`)
    }
    if (!/\.[cm]?[jt]sx?$/.test(path) || isolated(path) || history(path) || path === "scripts/check-architecture.mjs") continue
    const content = await readFile(join(root, path), "utf8")
    const { imports, symbols } = inspectSource(path, content)
    const owner = path.match(/^src\/capabilities\/([^/]+)\//)?.[1]
    const core = path.startsWith("src/core/")
    const integration = path.startsWith("src/integrations/")
    const consumer = /(?:^|\/)(?:plugins?|presentation|consumers)(?:\/|$)/.test(path)
    for (const specifier of imports) {
      const local = specifier.startsWith("file:") ? fileURLToPath(specifier) : specifier
      const target = local.startsWith(".") || local.startsWith("/") ? relative(root, resolve(root, dirname(path), local)).replaceAll("\\", "/") : local.replace(/^(?:andmar-ai\/|@\/)/, "")
      const sibling = target.match(/^(?:src\/)?capabilities\/([^/]+)(?:\/|$)/)?.[1]
      if (core && (/^(?:src\/)?(?:capabilities|integrations)\//.test(target) || /^assets\/skills\//.test(target))) failures.push(`Core ${path} imports forbidden owner ${specifier}.`)
      if (core && (specifier === "@opencode/plugin" || specifier.startsWith("@opencode/plugin/"))) failures.push(`Core ${path} depends directly on @opencode/plugin; no current exceptions.`)
      if (core && (coreDomain.test(target) || /^(?:simple-git|isomorphic-git|nodegit)(?:\/|$)/.test(target))) failures.push(`Core ${path} imports domain implementation ${specifier}.`)
      if (owner && sibling && sibling !== owner) failures.push(`Capability ${owner}: sibling implementation import in ${path}: ${specifier}.`)
      if (integration && sibling) failures.push(`Integration ${path} imports capability implementation ${specifier}.`)
      if (consumer && /^(?:src\/)?(?:capabilities|core)\//.test(target)) failures.push(`Presentation/plugin consumer ${path} imports internal ${specifier}; use RPC/events/public tools.`)
    }
    if (core && (coreDomain.test(basename(path)) || symbols.some(symbol => coreDomain.test(symbol)))) failures.push(`Core ${path} contains a domain/presentation/workflow symbol; keep implementation with its owner.`)
    for (const symbol of new Set(symbols.filter(symbol => legacy.test(symbol)))) failures.push(`Functional legacy symbol ${symbol} in ${path}.`)
  }
  const skills = (await readdir(join(root, "assets/skills"), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)
  for (const skill of skills) if (!files.includes(`assets/skills/${skill}/SKILL.md`)) failures.push(`Packaged skill ${skill} is missing SKILL.md.`)
  const capabilityDirs = (await readdir(join(root, "src/capabilities"), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)
  for (const name of capabilityDirs) if (!files.includes(`src/capabilities/${name}/index.ts`)) failures.push(`Capability ${name} is missing index.ts.`)
  const guide = await readFile(join(root, "docs/ANDMAR-AI-CAPABILITIES.md"), "utf8").catch(() => "")
  const seenTools = new Map()
  let version
  try {
    const artifacts = await capabilityArtifacts(root)
    version = artifacts.version
    for (const [path, expected] of artifacts.files) {
      if (await readFile(join(root, path), "utf8").catch(() => "") !== expected) failures.push(`${path} is not exactly synchronized; run bun run generate.`)
    }
    for (const row of artifacts.rows) {
      if (!guide.includes(`### \`${row.id}\``)) failures.push(`Capability ${row.id} has no canonical documentation section.`)
      for (const tool of row.tools) {
        if (seenTools.has(tool)) failures.push(`Tool ${tool} has duplicate ownership: ${seenTools.get(tool)} and ${row.id}.`)
        seenTools.set(tool, row.id)
      }
    }
    if (!(await readFile(join(root, "CHANGELOG.md"), "utf8")).includes(`## [${version}]`)) failures.push(`CHANGELOG.md has no entry for package version ${version}.`)
  } catch (error) { failures.push(`Generated contract validation failed: ${error.message}`) }
  return { failures, capabilities: capabilityDirs.length, skills: skills.length, tools: seenTools.size, version }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkArchitecture(fileURLToPath(new URL("../", import.meta.url)))
  if (result.failures.length) { console.error("Architecture check failed:\n- " + result.failures.join("\n- ")); process.exitCode = 1 }
  else console.log(`Architecture check passed (${result.capabilities} capabilities, ${result.skills} skills, ${result.tools} tools, version ${result.version}).`)
}
