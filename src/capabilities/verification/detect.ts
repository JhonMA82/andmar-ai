// Deterministic project toolchain detection (pure helpers, no OpenCode imports).
//
// Nothing here touches the disk or executes commands. The caller (human or
// agent) lists project files with native OpenCode tools and passes the names
// in; this module maps well-known signal files (lockfiles, manifests,
// config files) to suggested verification commands. Suggestions are always
// explicit about their source: an actual package script, a config file, or a
// toolchain convention the caller should confirm.

import type { VerificationCheck } from "./receipts.ts"

export interface SuggestedCheck {
  check: VerificationCheck
  command: string
  source: "script" | "config" | "convention"
}

export interface DetectedEcosystem {
  id: string
  signals: string[]
  checks: SuggestedCheck[]
}

export interface DetectionResult {
  ecosystems: DetectedEcosystem[]
  unknown: boolean
}

function basenames(files: string[]): Set<string> {
  const names = new Set<string>()
  for (const file of files) {
    const base = file.split("/").pop() ?? ""
    if (base !== "") names.add(base)
  }
  return names
}

interface NodeManager {
  id: string
  lockfiles: string[]
  dlx: string
}

const NODE_MANAGERS: NodeManager[] = [
  { id: "bun", lockfiles: ["bun.lock", "bun.lockb"], dlx: "bunx" },
  { id: "pnpm", lockfiles: ["pnpm-lock.yaml"], dlx: "pnpm dlx" },
  { id: "npm", lockfiles: ["package-lock.json"], dlx: "npx" },
  { id: "yarn", lockfiles: ["yarn.lock"], dlx: "yarn dlx" },
]

// package.json script name -> receipt check kind. "check" is a full-pipeline
// script by convention (like this repo's own `npm run check`), so it maps to
// custom rather than to any single check kind.
const SCRIPT_TO_CHECK: Record<string, VerificationCheck> = {
  test: "tests",
  lint: "lint",
  typecheck: "typecheck",
  build: "build",
  check: "custom",
}

function detectNode(names: Set<string>, scripts: string[]): DetectedEcosystem | undefined {
  const lockfile = NODE_MANAGERS.find((manager) => manager.lockfiles.some((lock) => names.has(lock)))
  if (!names.has("package.json") && !lockfile) return undefined
  const manager = lockfile ?? { id: "node", lockfiles: [] as string[], dlx: "npx" }
  const run = lockfile ? lockfile.id : "npm"
  const signals = [
    ...(names.has("package.json") ? ["package.json"] : []),
    ...manager.lockfiles.filter((lock) => names.has(lock)),
  ]
  const checks: SuggestedCheck[] = []
  for (const script of scripts) {
    const check = SCRIPT_TO_CHECK[script]
    if (check) checks.push({ check, command: `${run} run ${script}`, source: "script" })
  }
  const kinds = new Set(checks.map((check) => check.check))
  if (!kinds.has("tests")) checks.push({ check: "tests", command: `${run} test`, source: "convention" })
  if (names.has("tsconfig.json") && !kinds.has("typecheck")) {
    checks.push({ check: "typecheck", command: `${manager.dlx} tsc --noEmit`, source: "config" })
  }
  return { id: manager.id, signals, checks }
}

function detectDeno(names: Set<string>): DetectedEcosystem | undefined {
  const signals = ["deno.json", "deno.jsonc", "deno.lock"].filter((file) => names.has(file))
  if (signals.length === 0) return undefined
  return {
    id: "deno",
    signals,
    checks: [
      { check: "tests", command: "deno test", source: "convention" },
      { check: "lint", command: "deno lint", source: "convention" },
    ],
  }
}

function detectCargo(names: Set<string>): DetectedEcosystem | undefined {
  const signals = ["Cargo.toml", "Cargo.lock"].filter((file) => names.has(file))
  if (!names.has("Cargo.toml")) return undefined
  return {
    id: "cargo",
    signals,
    checks: [
      { check: "tests", command: "cargo test", source: "convention" },
      { check: "typecheck", command: "cargo check", source: "convention" },
      { check: "lint", command: "cargo clippy -- -D warnings", source: "convention" },
      { check: "build", command: "cargo build", source: "convention" },
    ],
  }
}

function detectGo(names: Set<string>): DetectedEcosystem | undefined {
  if (!names.has("go.mod")) return undefined
  return {
    id: "go",
    signals: ["go.mod"],
    checks: [
      { check: "tests", command: "go test ./...", source: "convention" },
      { check: "lint", command: "go vet ./...", source: "convention" },
      { check: "build", command: "go build ./...", source: "convention" },
    ],
  }
}

function detectPython(names: Set<string>): DetectedEcosystem | undefined {
  const manifests = ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile"].filter((file) =>
    names.has(file),
  )
  const locks = ["uv.lock", "poetry.lock", "Pipfile.lock"].filter((file) => names.has(file))
  if (manifests.length === 0 && locks.length === 0) return undefined
  const runner = names.has("uv.lock") ? "uv run " : names.has("poetry.lock") ? "poetry run " : names.has("Pipfile") ? "pipenv run " : ""
  const signals = [...manifests, ...locks]
  const checks: SuggestedCheck[] = [{ check: "tests", command: `${runner}pytest`, source: "convention" }]
  if (names.has("ruff.toml") || names.has(".ruff.toml")) {
    checks.push({ check: "lint", command: `${runner}ruff check .`, source: "config" })
  }
  if (names.has("mypy.ini") || names.has(".mypy.ini")) {
    checks.push({ check: "typecheck", command: `${runner}mypy .`, source: "config" })
  }
  if (names.has("pyproject.toml")) {
    checks.push({ check: "build", command: `${runner}python -m build`, source: "convention" })
  }
  return { id: "python", signals, checks }
}

export function detectProjectChecks(files: string[], scripts: string[] = []): DetectionResult {
  const names = basenames(files)
  const ecosystems: DetectedEcosystem[] = []
  for (const detected of [
    detectNode(names, scripts),
    detectDeno(names),
    detectCargo(names),
    detectGo(names),
    detectPython(names),
  ]) {
    if (detected) ecosystems.push(detected)
  }
  return { ecosystems, unknown: ecosystems.length === 0 }
}
