---
name: andmar-repo-navigation
description: Acquire useful repository context and locate code with bounded searches. Use before exploration, structural impact analysis or unfamiliar project changes.
---

Inspect repository-native context first: AGENTS.md, PROJECT_STATE, ROADMAP,
CHANGELOG and .engineering if present. Query active Work Ledger context through
`andmar_work_context`. Absence of AiContext/EP never blocks work.

Locate files before reading content. Use `rg --files` with path/glob filters.
Use installed tgrep for repeated/structural indexed searches in large repositories
when its actual CLI and index freshness offer an advantage. Inspect its help
once; do not invent flags or install it as an AndMar dependency.
Prefer `rg -n` for exact/local/simple/fresh searches, small repositories, changed
files, or unavailable tgrep. Limit paths and context lines. Read the located
function/range/section, expanding only when semantics require it.

Use available CodeGraph for symbol relationships, call graphs, impact and
architecture traversal. codebase-memory-mcp is optional. Before costly
index_repository, state its purpose and a bounded timeout; show progress and
cancel/fall back to tgrep/rg/targeted reads on timeout or failure. Do not wait
indefinitely or turn index availability into readiness policy.

Treat memory as bounded advisory context. Verify claims against current code.
If Engram is available, use project-scoped retrieval only when prior decisions
would change a concrete choice; consult installed plugin docs/ENGRAM.md for its
specific tool contract. Never persist operational WU/receipt state in memory.
