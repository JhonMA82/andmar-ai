# Architectural Inspirations

These projects were reviewed for patterns. **None is automatically a dependency or fork target.** AndMar AI extracts ideas while keeping its own scope small.

**Scope:** historical reference only. This document is not canonical for any
current rule — decisions that were actually taken live in
[DECISIONS.md](DECISIONS.md), and the current boundaries live in
[ARCHITECTURE.md](ARCHITECTURE.md).

## `nail00749/opencode-agent` (Gvozd)

Useful patterns:

- plugin-first architecture with lifecycle CLI separated from runtime logic;
- typed/small-model decision primitives;
- explicit permission/coordination concepts.

Not copied into MVP:

- large predefined agent taxonomy;
- fast/deep agent duplication;
- control center;
- file leases.

## `nrdz-labs/fast-jev-opencode`

Useful patterns:

- context is a projection, not the historical truth;
- deterministic filtering before semantic classification;
- cache semantic decisions;
- fail open when context optimization fails.

MVP decision:

- architecture reserves the idea, but context pruning/Jev waits for real context-cost measurements.

## `SebastianZonta/opencode-v2-delegate-tool`

Useful patterns:

- delegation as a primitive rather than a specialist-agent hierarchy;
- persistent child-session handle;
- bounded returned result;
- depth and ownership guards.

MVP adoption:

- native child sessions, handles, depth, resume and ownership.

## `tuancon254/superpowers-opencode-v2`

Useful patterns:

- methodology separate from runtime adapter;
- operational state in native storage;
- deterministic rehydration after context lifecycle events.

MVP adoption:

- methodology remains outside core;
- operational state is explicitly separate from memory/context.

## `cldmnky/opencode-orchestrator`

Useful patterns:

- durable operational board/state;
- worker self-report is not completion;
- verification tied to exact revision;
- soft prompt policy vs hard runtime policy;
- reconcile uncertain side effects before retrying.

MVP adoption:

- exact-revision completion gate and hard-policy mindset.

Deferred:

- full DAG/lead board;
- autonomous PR/publish lifecycle;
- sophisticated scope packets.

## `bergthorsten/opencode-plugin-lane`

Useful patterns:

- replace one OpenCode primitive rather than wrapping the runtime;
- isolation can be simpler than coordination;
- manage only resources you own;
- destructive actions require deterministic guards.

MVP decision:

- keep OpenCode native worktrees first; Lane can become an optional strategy later.

## `ocportal-dev/oc-dynamic-workflows`

Useful patterns:

- workflow-as-data;
- small composition vocabulary;
- schema validation;
- bounded review loops;
- synthesis boundaries;
- worker output as untrusted data;
- delegation cannot increase authority.

MVP decision:

- do not build the workflow engine yet. If demonstrated, start with only sequence/parallel/gate/repeat.

## `SoloUnity/herdr-subagent-panes`

Useful patterns:

- observability should listen to native events rather than intercept execution;
- UI should attach to real sessions;
- control-plane mutations can be serialized while workers remain parallel;
- strong ownership before manipulating resources.

MVP decision:

- no UI dependency; preserve normal OpenCode sessions/events so Herdr-style integrations remain possible.
