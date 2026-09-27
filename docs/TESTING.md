# Real-world testing

**Scope:** how to install the development build for real use, the test matrix
that should drive the next capability, and the current limitations. The
system-level explanation is [OVERVIEW.md](OVERVIEW.md); the architecture is
[ARCHITECTURE.md](ARCHITECTURE.md).

**Historical base snapshot (0.7.x era):** `JhonMA82/andmar-ai` main at commit `2f50effef624570b6e686d71caa6d430f77a467f`, plus the intake pilot, the `AndMar` primary agent, and the verification-evidence changes documented in the changelog. Current behavior is described by [SCOPE.md](SCOPE.md) and the generated [CAPABILITIES.md](CAPABILITIES.md).

The core evolution (Intake → Work Ledger → lifecycle → checkpoints →
Completion → Review → development metrics → Delivery) is complete at
`v0.15.0`; real use should now drive measured-friction improvements, bug
fixes and simplifications rather than a new capability.

At the `v0.15.0` consolidation revision, `bun run check` runs **258**
deterministic tests (architecture check + typecheck + suite). Treat that
number as revision-bound: the current value is whatever `bun run check`
prints in your checkout.

## Install the development build

The canonical install/uninstall steps live in
[../README.md](../README.md) "Quick start":

```bash
bun install
bun run check
bun run install:dev
bun run doctor
opencode service restart
```

`bun run doctor` is read-only and fails if OpenCode v2 is missing, the plugin link points elsewhere, the agent differs from this checkout, or the plugin API dependency is not exactly pinned.

`install:dev` does not edit your OpenCode JSON configuration; it uses OpenCode
V2's global discovery locations and `uninstall:dev` only removes what it still
owns.

Start OpenCode in the project you want to test and use **Tab** to select the `AndMar` primary agent. `Build` and `Plan` remain available and unchanged.

## What the first tests should answer

Do not add Workflow, context projection, or more agents before these tests produce evidence that they are needed. Do not add an AndMar memory subsystem or memory capability: Engram is the existing optional external memory integration (see [ENGRAM.md](ENGRAM.md)), and it never becomes work state or completion evidence. (The narrow `intake` Jev pilot is already implemented; broader semantic uses still wait for evidence.)

| Scenario | Example | What to observe |
|---|---|---|
| Trivial | README/text change | AndMar stays lightweight and does not create ceremony |
| Bug fix | Fix a known failing test | Relevant checks run and evidence is tied to final working state |
| Feature | Small bounded feature | Routing/delegation add value only when useful |
| Migration/integration | Port a plugin to current OpenCode V2 | Upstream contract + runtime boundary + CI are checked, not only mocks |
| Restart | Stop OpenCode during a real task and return | Measure exactly what continuity is missing before implementing Workflow |

For every scenario record:

- whether the first result was actually usable;
- missing issues discovered after the agent said it was finished;
- number of user corrections/interventions;
- unnecessary tool/model/delegation overhead;
- whether verification receipts matched the final dirty/clean working state;
- whether Build would have been simpler for that task.

## Current limitation being measured

AndMar AI has durable verification and contract state in `ctx.storage`, plus
the repository-native Work Ledger (`.andmar/work/<work-id>/`) for portable
cross-session continuity. It deliberately still has no runtime workflow or
orchestration record.

The session-scoped Task Contract (`andmar_task_contract`) now covers the
active-task part for the current session: goal, requirements, constraints,
blockers and review rounds survive restarts via plugin storage, and
`status` re-projects them compactly after compaction. Work Ledger recovery
covers the portable side: `WORK.md` is read before restarting from scratch,
and the deterministic lifecycle helper restores unit state. What is still deliberately missing is cross-session takeover:
`andmar_resume` intentionally enforces parent-session ownership for delegated
child sessions, and review sessions are never resumed at all. A brand-new
parent session therefore must not silently take ownership of an old child.

If restart/session continuity becomes a repeated real-world friction, that is evidence for the first minimal `workflow` capability:

```text
active task
completion contract
status
resume
completion gate
```

Do not implement a general DAG/DSL merely to solve continuity.

## Completion expectations while testing

The `AndMar` primary agent should:

- use native OpenCode tools for implementation;
- use AndMar primitives only where they add deterministic value;
- bind receipts to a working-state fingerprint, not only `HEAD` when the tree is dirty;
- run relevant checks before completion;
- evaluate docs/version impact;
- use stronger upstream/runtime verification for migration, integration, security, and architecture work;
- explicitly report any runtime check that could not be performed.

A green self-authored mock is evidence about the mock, not proof of an external runtime integration.

## Behavioral benchmark (next step, before any new capability)

With the Task Contract core implemented, the next capability is frozen
until a small benchmark compares harness value on real tasks:

```text
OpenCode plain + same model  vs  AndMar + same model
```

Plan: 10–20 real tasks (mix of trivial, feature, bugfix, migration).
Measure per task: requirements missed, false completion, verification
omissions, review catches, iterations, whole-task success, duration, and
token/cost when observable. Process is fixed: evidence → human analysis →
proposed change → human approval → implementation. Results never mutate
the harness automatically (see D-019).

## Real OpenCode smoke record (2026-09-22)

Executed via `opencode run --standalone --agent andmar` in a scratch CLI
project (`node greet.js`), multi-requirement task: add `--json`, keep the
default output, update tests, update README, touch nothing else, run the
real CLI smoke, verify through the harness.

```text
smoke 1 (default free model): contract created with 7 requirements, all
  preserved; receipts + verify ok; gate DENIED (pending REQ-7, review
  missing); 7 reviewer attempts returned no parseable verdict; agent
  reported honestly "not formally complete" instead of a false done —
  the negative path (green tests ≠ completion) proven in real runtime.

smoke 2 (same model, after tolerant verdict parsing): gate still denied;
  reviewer produced reasoning/tool calls but no final text; contract
  correctly refused an illegal satisfied->blocked transition; honest
  blocked report again. Root cause found: session.prompt returns the
  queued inbox record, not the child's answer (see OPENCODE-V2.md).

smoke 4 (pinned stronger model, after runChildTask fix): full positive
  path — contract created (6 explicit requirements), evidence recorded
  sequentially, receipts + verify ok, ONE fresh reviewer session returned
  {"verdict":"approve"} (stored), completion gate ok:true and closed the contract in the same call, final report 6/6 requirements with honest limitations.
```


Reviewer verdict quality depends on the model behind the `frontier`
profile; without a mapping the reviewer inherits the parent model.

## Real API typecheck vs offline check

`bun run check` is the authoritative repository check. After `bun install`, it typechecks against the pinned real `@opencode/plugin` package.

For environments without registry/network access, `bun run check:offline` exists only as a structural fallback and uses the local type shim. A passing offline check is **not** evidence of OpenCode API compatibility and must never replace `bun run check` in CI or release validation.


## Work Unit lifecycle regression coverage

`tests/work-unit-lifecycle.test.ts` exercises the repository-native Work Unit lifecycle helper against real `WORK.md` files. Coverage includes pending→active, active→done with declared evidence, automatic/explicit next-unit selection, blocking/resume, explicit reopen, rollback on invalid evidence, completed-ledger immutability, and preservation of structural validity. `tests/install-dev.test.ts` also executes the lifecycle helper through the installed global AndMar plugin path from an unrelated consumer repository.

## Work Unit checkpoint regression coverage

`tests/work-unit-checkpoint.test.ts` uses real temporary Git repositories. It covers exact verified-revision gating, metadata-only skip behavior, deterministic commit trailers, current-HEAD recording, rejection of mismatched Work Unit trailers, idempotent SHA recording, and stale checkpoint clearing on reopen. Work Ledger validator tests cover malformed/non-done/duplicate checkpoint references. `tests/install-dev.test.ts` executes the checkpoint helper through the installed global plugin path as a consumer-repository smoke.


## Engram lateral integration regression coverage

`tests/engram-integration.test.ts` verifies JSONC/OpenCode config discovery, effective precedence for partial overrides, agent-profile detection, fail-open startup semantics, runtime-observed availability, and metadata-only memory observability. `tests/engram-setup.test.ts` verifies that AndMar delegates configuration to the upstream-owned `engram setup opencode` command instead of rewriting MCP configuration itself. The suite intentionally does not mock Engram as completion evidence because memory is advisory.
