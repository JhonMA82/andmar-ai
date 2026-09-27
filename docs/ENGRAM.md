# Engram Integration

AndMar integrates with Engram as an **optional lateral integration**, not as a capability and not as part of the completed AndMar core.

## Boundary

AndMar owns deterministic development guarantees. Engram owns persistent historical memory.

```text
OpenCode V2
   |
   +-- AndMar core
   |    Intake -> Work Ledger -> Verification -> Review -> Completion -> Delivery
   |
   +-- Engram MCP
        persistent advisory memory
```

Engram being absent, unavailable, slow, or unhealthy must never invalidate Work Ledger state, Verification evidence, Completion, or Delivery.

## Authority

Use this precedence when sources disagree:

```text
current explicit user instruction
> current repository facts + portable Work Ledger / Task Contract obligations
> exact-revision Verification for the matching state
> Engram historical memory
> model memory
```

Engram is context, never proof of current repository state.

## Why this is an integration, not a capability

Capabilities exist when AndMar must enforce a runtime guarantee. Engram is optional and advisory; failure degrades recall but does not block work. AndMar therefore does not add `andmar_mem_*` tools, a memory database, a memory lifecycle engine, or a second session state system.

The native Engram MCP tools remain owned by Engram (`mem_context`, `mem_search`, `mem_save`, `mem_get_observation`, and related tools).

## Setup

Engram 2.x owns its OpenCode configuration. AndMar delegates setup instead of rewriting the MCP entry itself:

```sh
npm run engram:setup
```

The script performs:

```text
engram version
engram setup opencode
```

The official Engram setup writes the OpenCode MCP server using the agent tool profile (`engram mcp --tools=agent`). Administrative Engram tools are intentionally not required by normal AndMar work.

For a stable project identity across machines, initialize Engram from the repository when useful:

```sh
engram init <canonical-project-name>
```

This creates `.engram/config.json`. Do not set a global `ENGRAM_PROJECT` for normal multi-project development; a process-wide override can route memory to the wrong project.

## Runtime detection

At AndMar startup the lateral adapter performs only cheap, bounded discovery:

1. run `engram version` with a short timeout;
2. inspect OpenCode configuration in effective precedence order (global -> `OPENCODE_CONFIG` -> project -> custom config directory -> inline content);
3. merge partial Engram overrides instead of treating the first matching file as authoritative;
4. recognize both `mcp.engram` and the transitional `mcp.servers.engram` layout;
5. confirm the effective configured command launches `engram ... mcp`;
6. record a bounded integration status in AndMar runtime storage.

`andmar_status` exposes the result under `integrations.engram`.

Example before a memory tool has run:

```json
{
  "provider": "engram",
  "mode": "advisory",
  "installed": true,
  "configured": true,
  "enabled": true,
  "available": true,
  "availabilityBasis": "binary+config",
  "version": "engram v2.2.1",
  "configSource": "~/.config/opencode/opencode.jsonc",
  "agentProfile": true,
  "runtimeObserved": false
}
```

After a successful real `engram.mem_*` call, the adapter upgrades the evidence to:

```json
{
  "availabilityBasis": "observed-tool-call",
  "runtimeObserved": true
}
```

This is intentionally not a deep health probe on every OpenCode session.

## Deep diagnostics

Engram remains responsible for Engram diagnostics:

```sh
engram doctor --json
engram test --quick --json
```

AndMar must not reproduce Engram's SQLite, WAL, sync, conflict, project-maintenance, cloud, or reliability checks.

Cloud is optional and outside the AndMar integration contract.

## Retrieval policy

OpenCode receives Engram's own MCP instructions. AndMar adds only its own authority and bounded-use rules.

Use Engram when historical context has real value:

- the user refers to previous work;
- continuing across sessions may require a durable old decision;
- an expensive investigation may already have been solved;
- a project convention, tool quirk, or architectural rationale may be historical rather than visible in current code.

Do not query memory if the repository, Work Ledger, Task Contract, or current Verification already answers the question.

Preferred retrieval:

```text
mem_current_project / project resolution
        |
        v
mem_context (current project)
        |
   enough? -- yes --> stop
        |
        no
        v
one targeted mem_search (current project)
        |
   relevant hit --> mem_get_observation only when full content is needed
```

Cross-project retrieval is exceptional. Use it only when the user explicitly references another project or there is concrete evidence that reusable knowledge lives elsewhere. Do not fan out speculative searches across all projects.

## Save policy

Save only durable, reusable knowledge:

- architecture/design decisions and rationale;
- stable project conventions;
- library/tool choices with tradeoffs;
- non-obvious codebase discoveries;
- reusable bug root causes and gotchas;
- stable user/project constraints relevant to future work.

Prefer stable `topic_key` values for evolving knowledge so an evolving decision does not become a set of contradictory observations.

Prefer repository-relative paths in memory. Absolute machine paths reduce portability between development machines.

Do not save:

- Work Unit status;
- Task Contract runtime state;
- verification receipts;
- current test counts/status;
- transient failures;
- raw logs/tool output;
- secrets;
- source code dumps;
- raw prompts merely because an automated harness artifact was written.

Work Ledger remains the portable source of current work truth.

## Stale memory

A memory marked `needs_review` is stale context, not a trusted fact. Verify it against current repository/evidence before relying on it. Do not automatically mark memory reviewed; that is an explicit memory-maintenance action.

## Failure semantics

Memory failure is never a task failure:

```text
Engram timeout/error/unavailable
        -> continue current work
        -> use repo/Work Ledger/current evidence
        -> deliver the user-facing result normally
```

No completion or delivery gate depends on Engram.

## Development metrics

The integration observes only metadata for native Engram MCP calls:

- operation name (`mem_context`, `mem_search`, etc.);
- completed/error status;
- whether `all_projects=true` requested cross-project retrieval.

It never records the search query, memory content, prompt, or tool output.

`andmar_report` reports:

```text
memory.calls
memory.context
memory.searches
memory.reads
memory.saves
memory.crossProjectCalls
memory.failures
```

These metrics exist to detect memory fan-out or instability, not to maximize memory usage.

## Sync and multiple machines

Engram already owns export/import/sync:

```sh
engram sync
engram sync --import
engram sync --status
```

Evaluate repository sync before introducing Engram Cloud. AndMar does not automate sync until real use demonstrates a repeated need and a safe ownership model.

## Maintenance

Engram also owns project cleanup and conflict tooling:

```sh
engram projects consolidate --dry-run
engram projects prune --dry-run
engram conflicts ...
```

AndMar never runs destructive or confirmation-requiring memory maintenance automatically.

## Non-goals

This integration intentionally does not provide:

- an AndMar memory capability;
- wrappers around `mem_*`;
- a second memory store;
- automatic cross-project search;
- automatic Engram Cloud enrollment;
- automatic project consolidation/deletion;
- mandatory session summaries;
- memory as completion evidence;
- memory as a replacement for Work Ledger.
