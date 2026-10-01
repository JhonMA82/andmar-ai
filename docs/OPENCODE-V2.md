# OpenCode V2 API Assumptions

This file records the OpenCode V2 primitives AndMar intentionally relies on, so future upgrades can audit compatibility without reading the entire repository.

**Scope:** the external contract this repository depends on. Architectural
boundaries derived from it are summarized in [ARCHITECTURE.md](ARCHITECTURE.md)
§2.4; this document stays authoritative for the API shape itself.

Validated package target for this test build: `@opencode/plugin@2.0.4`.

Reference documentation used during the design:

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
tool, session, command plus normalized form, status, observed process
outcome, timestamp and optional `outputDigest` sha256) under
`verification-evidence/<executionId>` plus the diagnostic
`journal/<sessionID>/<callID>` entry. Full inputs/outputs are never
persisted by the observer.

### Native shell exposes the process outcome in `metadata.exit`

Observed 2026-09-30 against the installed OpenCode `2.0.21`: the native
shell tool reports a failing process as a **completed** tool call whose
result metadata carries the real process outcome. The keys are `exit`,
`signal` and `timeout` — there is no `exitCode` key:

```text
result: {
  output: "...",            // never stored by AndMar
  metadata: { output: "...", truncated: true, exit: 1 },   // exit: 0 when green
}
```

AndMar reads `metadata.exit` (and `metadata.exitCode` / top-level `exitCode`
/ `exit` as equivalent shapes from other tooling), plus `metadata.signal`
and `metadata.timeout`, and stores them as minimal evidence. Reading
`metadata.exitCode` instead leaves the observed outcome permanently
`undefined`, which silently turns every failing run into an acceptable
`passed: true` — the `Tool.Metadata` type is `Record<string, any>`, so the
type surface cannot catch this; only observation can.

## Sessions

Verified 2026-09-22 against the installed `@opencode/plugin@2.0.4`
generated client types:

```text
ctx.session.prompt({ sessionID, text })  // QUEUES the user message and
                                         // resolves immediately with a
                                         // SessionInboxUser record
ctx.session.wait({ sessionID })          // resolves when the session is idle
ctx.session.context({ sessionID })       // SessionMessageInfo[]
                                         // user messages carry `text` directly
                                         // assistant messages carry
                                         // content: [{ type: "text", text }]
```

`session.prompt` does NOT return the child's answer — it returns the queued
user prompt (`SessionInboxUser`). To obtain a child's response the pattern
is `prompt -> wait -> context`. Delegation uses the generic
`src/core/session.ts` (`runChildTask`). Before v0.5.x the harness serialized
the prompt result object instead of the child's actual answer: the child had
answered, but the answer was unread through the wrong shape.

OpenCode V2 child sessions inherit the permission rules in effect at
creation. AndMar AI relies on that native behavior instead of constructing
a parallel permission model. AndMar creates child sessions only for
Delegation, and never grants a child permissions the parent does not hold.

Verified 2026-09-22 against the same types (`SessionCreateInput`): the
typed shape exposes `id/title/agent/model/location/metadata/permissions`
but no `parentID` field. The harness keeps the established `parentID`
runtime pattern (shared with the pre-existing `delegation` capability,
which real-world testing exercises) because `ctx` is untyped at the
capability boundary; if a future typed client rejects it, both
capabilities must move together. Do not invent a parallel
session/permission layer around this gap.

### Compaction: pull, don't hijack

A session `compaction` hook with an overridable `result` summary exists
in the installed types, but setting it would replace the whole
compaction summary with the contract projection and destroy context the
model still needs. AndMar therefore does not hook compaction: after
compaction or restart the agent recovers continuity by calling
`andmar_task_contract status` (compact brief, no transcript).

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

AndMar does not override worktrees. A future adapter should use `ctx.worktree.transform()` so removing the adapter restores OpenCode's strategy.

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


## Work observation and optional presentation RPC

Inspected against the installed `@opencode/plugin@2.0.4` in this change:
`promise/tool.d.ts` exposes `execute.before`/`execute.after` with stable call IDs;
`promise/rpc.d.ts` exposes `register` and registration events; `Rpc` portable
schemas accept JSON Schema. The VCS client exposes `status({location})` with
`{location, data: FileStatus[]}` (`file`, additions/deletions, status). Lifecycle
uses no new dependency and does not upgrade the validated package target.

WorkRpc is a read-only `get` plus `changed` notification. RPC setup/send failure
is isolated; native execution remains available. Structured edit output shapes
are adapted from the reference plugin, because generic Tool.Result cannot
prove the outputs of every concrete tool. Unsupported shapes and unavailable
VCS are explicitly reported as coverage gaps, never parsed from prose.

The reference plugin requires OpenCode >=2.0.19 and TUI peers. AndMar does not
copy its TUI, export layout or application APIs. Live V2 execution, permission
propagation through codemode and concrete VCS/edit outputs must be smoke-tested
on the user's installed version before claiming live integration compatibility.
An exception blocks subsequent observed session tools; already-running native
calls and unrelated external processes are not cancelled by this observer.


### Checkpoint audit on the real 2.0.20 runtime

Inspected the official `v2.0.20` tag: `packages/core/src/tool.ts` constructs
`execute.before/after` with `tool`, `id`, `sessionID`, `messageID`, `input`,
status and structured result/error. `packages/core/src/codemode/tool.ts`
passes the SAME outer context/call ID to child calls. Child tool names are
canonical catalog paths (`andmar.work_resume` observed live). Native shell,
edit, write and read default to `codemode:false`; a smoke-only plugin exposed
edit/write as children to test that the native registry enforces the gate.
AndMar neither changes these defaults nor adds a dependency.

`SessionMessage.User.time.created` is DateTime.Utc in the promise context
(and milliseconds on the encoded API); `session-message.ts` and
`identifier.ts` define ascending `msg_` IDs with a timestamp/counter prefix.
The WU checkpoint timestamp avoids relying on the presence of an origin in
compacted context or on session identity.

Two real upstream boundaries remain important:

- `codemode/web.ts` installs a global `fetch` using globalThis.fetch, without
  tool hooks or permission checks. It can issue HTTP during a bound blocked
  session. The checkpoint gate does not claim a network sandbox. A lexical
  source shadow was evaluated and discarded: binding or checkpoint creation
  inside an already-running outer program makes a before-only restriction
  insufficient. No source parser/rewriter or hidden retry was added.
- Custom multi-shell Code Mode exposure can share native IDs. Verification
  allocates deterministic collision suffixes under its existing evidence keys,
  serializes metadata insertion, and never replaces an earlier revision-bound
  execution. The wrapper is excluded from evidence. Default native shell
  behavior and existing receipt IDs remain compatible.

These boundaries constrain what a checkpoint can guarantee: it controls
subsequent observed tools, not a universal HTTP or security sandbox. Promotion
to a stable release remains an explicit decision after validating the
operational flow on a real OpenCode session.

## Native skills — installed OpenCode 2.0.21 audit

Verified binary `opencode v2.0.21` and official tag `v2.0.21` (8a8bd622).
`packages/core/src/config/plugin/skill.ts` scans `skill` and `skills` under native
configuration directories using `{*.md,**/SKILL.md}` with symlink traversal.
`skill-file.ts` accepts YAML name/description and Markdown body; directory basename
is the native ID. AndMar packages `<name>/SKILL.md`, installing into
`${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/skills/<name>` through dev links.

Configuration discovery/load orders lower to higher: wellknown, global directory,
explicit file, direct project config, project `.opencode` directories, then config
content. Skill sources follow directory entries, then explicit configured skills;
later sources replace earlier identical IDs. AndMar does not override this native
precedence. The model loads with native `skill({name})`; no AndMar skill tool.
Native discovery/activation is asynchronous, so acceptance waits boundedly for
registration rather than treating an initial empty inventory as missing skills.

The shipped acceptance script exercises this real scanner and native skill
loading, shell execution, Code Mode calls, receipt association, nonzero rejection,
stale-revision verification/gate and corrupt-Ledger recovery. Its deterministic
model fixture selects calls only; it does not fake hooks, storage, tool results or
permissions. See TESTING.md for invocation and evidence limits.
