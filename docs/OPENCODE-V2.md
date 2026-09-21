# OpenCode V2 API Assumptions

This file records the OpenCode V2 primitives the MVP intentionally relies on, so future upgrades can audit compatibility without reading the entire repository.

Validated package target for this test build: `@opencode/plugin@2.0.4`.

Reference documentation used during the MVP design:

- https://opencode.ai/v2/docs/build/plugins
- https://opencode.ai/v2/docs/plugins
- https://opencode.ai/v2/docs/models
- https://opencode.ai/v2/docs/agents

## Plugin lifecycle

The package uses the V2 `Plugin.define({ id, setup })` entrypoint.

## Durable storage

Expected operations:

```text
ctx.storage.get
ctx.storage.set
ctx.storage.remove
ctx.storage.scan
```

Storage is plugin-scoped and used only for operational state.

## Tools

Capabilities register tools through:

```text
ctx.tool.transform(editor => ...)
```

Tool transforms must remain synchronous/replayable; async work belongs in the tool executor.

## Hooks

AndMar AI uses (verified against `@opencode/plugin@2.0.4` `dist/promise/tool.d.ts` and `dist/promise/shell.d.ts`):

```text
ctx.tool.hook("execute.after", ...)
ctx.shell.hook("create.before", ...)
```

It intentionally does not use legacy V1 event/hook names.

### `execute.after` is the observation contract (confirmed, not deprecated)

The `execute.after` hook is the only stable hook that carries an observed
outcome, and it exists identically in both the `promise` and `effect`
variants (`ToolDomain.hook` over `ToolHooks`). There is no better stable
alternative: `ctx.shell` exposes only `create.before` (timeout/cwd/command
mutation, no result). Verified 2026-09-21 against the installed `2.0.4`
type surface.

Event shape relied upon:

```text
{
  tool: string,          // e.g. "bash"; AndMar-owned tools are skipped
  sessionID: Session.ID,
  agent: Agent.ID,
  messageID: SessionMessage.ID,
  id: Tool.CallID,       // stable call id — NOT `callID` (never existed)
  input: unknown,        // observed arguments (bash: { command }); command extracted, never stored whole
  status: "completed" | "error",
  result?: Tool.Result,  // completed — digested, never stored whole
  error?: Tool.Error,    // error — digested, never stored whole
}
```

AndMar stores only minimal metadata (`executionId` as internal call id,
tool, session, command plus normalized form, status, timestamp and optional
`outputDigest` sha256) under `verification-evidence/<executionId>` plus the
diagnostic `journal/<sessionID>/<callID>` entry. Full inputs/outputs are
never persisted by the observer.

## Sessions

Delegation expects:

```text
ctx.session.get
ctx.session.create({ parentID, title, model, metadata })
ctx.session.prompt
```

OpenCode V2 child sessions inherit the permission rules in effect at creation. AndMar AI relies on that native behavior instead of constructing a parallel permission model.

## Models

OpenCode owns provider/model availability. AndMar AI stores only `ModelRef` values already valid in OpenCode:

```ts
{ providerID, id, variant? }
```

Missing mappings inherit the parent's model.

## VCS

The core has revision-bound evidence semantics, and the `verification`
capability implements receipts bound to an explicitly supplied revision
(normally a working-state fingerprint covering HEAD plus staged, unstaged, and
untracked changes — not `HEAD` alone when the tree is dirty).

Automating revision capture from native VCS events remains a candidate:

```text
ctx.vcs.get
ctx.vcs.status
ctx.vcs.diff
```

rather than shelling out to Git unless a V2 API gap is demonstrated.

## Worktrees

The MVP does not override worktrees. A future adapter should use `ctx.worktree.transform()` so removing the adapter restores OpenCode's strategy.

## Upgrade audit checklist

When targeting a newer OpenCode V2 release, verify:

1. `Plugin.define` import/package name;
2. `ctx.tool.transform` executor context shape (especially session identity);
3. session create parent/model/metadata fields;
4. child permission inheritance behavior;
5. storage scan pagination shape;
6. hook event names;
7. model ref shape.

Run the repository checks after any API update and test the installed package, not only a workspace-linked copy.


## Type validation policy

CI and the authoritative `bun run check` must typecheck against the installed `@opencode/plugin` dependency. `tsconfig.check.json` and the local shim are retained only for explicit offline structural checks (`bun run check:offline`) and are not runtime/API proof.
