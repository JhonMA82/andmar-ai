# MVP Scope

## Objective

Validate the architecture of AndMar AI with enough working behavior to prove the extension model, without prematurely implementing a complete agent platform.

## In scope

### Stable core contracts

- capability interface;
- generated capability manifest;
- plugin option configuration;
- durable state adapter;
- deterministic model policy;
- documentation/version/completion helpers.

### OpenCode integration

- V2 plugin entrypoint;
- tool transforms;
- tool execution hook;
- shell create hook;
- native session create/prompt for delegation;
- plugin storage.

### User-visible primitives

- AndMar custom primary agent as an optional user-facing entrypoint;
- status;
- route;
- delegate;
- resume;
- change impact;
- completion gate.

### Documentation

The repository itself must be sufficient for a capable coding agent to extend without requiring conversation history.

## Explicitly out of scope

### Workflow engine

We have enough architectural evidence to reserve the concept but not enough runtime evidence to justify implementation. A future MVP+1 may add only:

```text
sequence
parallel
gate
repeat
```

before considering anything more expressive.

### Context projection / Jev

The architecture allows a future context capability, but the MVP first needs real token/context measurements. Adding a semantic classifier now would violate the “demonstrated friction first” rule.

### Memory

No vector database, Engram-style memory or retrieval layer. Durable operational state is sufficient for the MVP.

### Worktree replacement

Use OpenCode's native worktree primitive first. Lane or another copy-on-write strategy becomes relevant only after real parallel-worker cost is measured.

### UI / Herdr adapter

Observability remains external. The harness should produce normal OpenCode sessions/events so existing UI integrations can observe them.

### Release automation

The MVP detects version implications; it does not edit versions, write changelogs automatically, tag, push, create PRs or publish packages.

## Success criteria

The MVP is successful when:

1. a local OpenCode V2 install can load the plugin;
2. model profile decisions are deterministic and independently testable;
3. a child session can be created and resumed with a durable handle;
4. authority is not raised by delegation;
5. documentation mappings can flag likely stale docs;
6. stale-revision evidence blocks completion;
7. a new capability can be added without modifying the root plugin/core;
8. human and agent documentation explain the architecture without relying on prior chat context;
9. the AndMar primary agent can be installed without replacing Build/Plan or editing user config.

## What should trigger the next capability

Only measured friction. Examples:

- repeated manual orchestration -> workflow capability;
- recurring context waste -> context projection;
- ambiguous routing large enough to matter -> Jev decision adapter;
- expensive parallel worktree creation -> Lane adapter;
- poor visibility into workers -> optional Herdr adapter.
