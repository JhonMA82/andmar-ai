# Scope

**Scope:** what AndMar AI `v0.15.1` guarantees today, what is optional, and
what it deliberately does not promise. It is a scope record, not an
architecture document: the system explanation is [OVERVIEW.md](OVERVIEW.md)
and the boundaries are [ARCHITECTURE.md](ARCHITECTURE.md). Forward-looking
triggers with their evidence requirements live in [ROADMAP.md](ROADMAP.md).

Current baseline: **v0.15.1**. This document replaces the retired
`MVP-SCOPE.md`, which described the earlier 0.1-era baseline and had become
contradictory (it denied Engram and Delivery, which now exist).

## Current baseline: the core evolution is complete

The planned eight-step core evolution is finished:

```text
1. Intake                    direct | enrich | structure
2. Work Ledger               repository-native portable state
3. Work-unit lifecycle       deterministic helper
4. Work-unit checkpoints     focused verification + recovery commits
5. Completion simplification evidence-derived completion
6. Development metrics       intervention / friction / recovery / value
7. Delivery                  authorization + readiness only
```

There is no planned Step 9. Additional work is classified as a bug fix, a
simplification, a measured-friction improvement, a skill, a script, an
external integration, or an isolated capability only when a runtime guarantee
requires it.

Inventory (generated, never hand-edited): 9 capabilities, 15 tools —
see [CAPABILITIES.md](CAPABILITIES.md) and
[ANDMAR-AI-CAPABILITIES.md](ANDMAR-AI-CAPABILITIES.md).

## Implemented guarantees

### Stable core contracts

- capability interface and generated capability manifest;
- plugin option configuration;
- durable operational state adapter (`ctx.storage`);
- deterministic model policy (`fast` / `standard` / `frontier`, never model
  IDs inside capabilities);
- documentation/version impact detection;
- exact-revision verification evidence;
- evidence-derived completion boundary;
- authorization/readiness gating for delivery operations.

### OpenCode integration

- V2 plugin entrypoint, tool transforms and tool execution hook;
- shell create hook with native permission primitives left authoritative;
- native session create/prompt for delegation;
- plugin storage.

### User-visible primitives

One tool namespace, `andmar`, registered by the nine capabilities
(`system`, `routing`, `delegation`, `lifecycle`, `verification`, `intake`,
`task-contract`, `development-metrics`, `delivery`), plus the optional
`AndMar` primary agent in `assets/agents/andmar.md`.

### Work Ledger (repository-native, not a capability)

`.andmar/work/<work-id>/` carries portable repository state: Work Units,
requirements, evidence pointers and recovery state. It travels with Git, does
not use `ctx.storage` as its source of truth, is not semantic memory, and is
excluded from the working-state revision fingerprint. The deterministic
helpers (`validate-work-ledger.mjs`, `work-ledger-lifecycle.mjs`,
`work-unit-checkpoint.mjs`, `working-state-revision.mjs`) stay scripts.

### Completion

`completionReady` in the Ledger -> integrated exact-revision Verification ->
`andmar_completion_gate`, which derives verification truth from stored evidence,
requires every Task Contract requirement to be resolved and evidenced for the
same revision, requires clean docs/version obligations, and closes the Task
Contract in the same operation -> Ledger `finalize --revision`.

There is no independent-review subsystem. No second LLM judges completion.

### Delivery

`andmar_delivery` decides only **authorization + readiness** for one named
operation (`commit`, `push`, `pull-request`, `merge`, `tag`, `version`,
`publish`, `release`). OpenCode executes the operation with native tools.
Authorization is operation-specific and never inferred transitively.

### Development metrics

`andmar_report` reports bounded local diagnostics (intervention, friction,
useful intervention, rework, checkpoint/recovery coverage, Engram call
signals). Metrics never gate completion or delivery.

## Optional integrations

- **Engram** (`src/integrations/engram/`): advisory persistent historical
  memory through native Engram MCP tools. It is a lateral integration, not a
  capability; unavailable Engram makes AndMar continue normally. See
  [ENGRAM.md](ENGRAM.md).
- **Semantic observability sink**: best-effort, content-free local `POST
  /events`; no capability depends on delivery succeeding.
- **Skills and scripts**: knowledge and deterministic automation loaded
  through OpenCode, outside the capability inventory.

## Intentional non-goals

These are omissions by design, not missing TODOs:

- a workflow engine, DAG/DSL, nested workflows or swarm chat;
- an AndMar memory subsystem, memory capability, memory database or memory
  lifecycle engine (persistent memory is Engram's job);
- a vector store or general semantic memory inside AndMar;
- semantic decisions beyond the bounded `intake` Jev pilot;
- a release engine: AndMar detects version obligations and gates
  authorization; OpenCode performs version/tag/publish/release natively;
- worktree replacement (Lane/copy-on-write) and a Herdr/UI adapter;
- multi-runtime compatibility or a provider/model abstraction layer;
- a custom terminal dashboard, file leases, or a generic plugin framework
  on top of the capability framework;
- autonomous PR/release publication.

## Legacy compatibility

Compatibility paths remain only because tests still cover them; the normal
agent flow neither uses nor recommends them:

- the manual `testsPassed` completion input;
- legacy completion-seal / completed-close compatibility.

Removing them is a separate breaking change with real evidence, not part of
routine cleanup.

## Future work requires measured friction

Nothing here is scheduled. Each item needs its trigger from
[ROADMAP.md](ROADMAP.md):

```text
bug fix                          -> always allowed
simplification                   -> shrinks the system
measured-friction improvement    -> evidence first
skill                            -> knowledge/procedure, no runtime guarantee
script                           -> deterministic automation
external integration             -> optional, removable, fail-open
isolated capability              -> only when a runtime guarantee is required
```

## Success criteria (still the bar)

The current baseline is healthy when:

1. a local OpenCode V2 install loads the plugin;
2. profile decisions are deterministic and independently testable;
3. a child session can be created and resumed with a durable handle without
   gaining authority;
4. stale-revision evidence blocks completion;
5. a new capability can be added without modifying the root plugin/core;
6. documentation explains the architecture without chat history;
7. the `AndMar` agent installs without replacing Build/Plan or editing user
   config;
8. a task with pending or unevidenced Task Contract requirements cannot
   complete even with green tests;
9. Engram being absent or failing changes nothing about completion or
   delivery;
10. repository documentation and generated inventaries describe the same
    system as the code.
