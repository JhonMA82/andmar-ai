# Real-world testing

**Scope:** how to install the development build for real use, the test matrix
that should drive the next capability, and the current limitations. The
system-level explanation is [OVERVIEW.md](OVERVIEW.md); the architecture is
[ARCHITECTURE.md](ARCHITECTURE.md).

**Historical base snapshot (0.7.x era):** `JhonMA82/andmar-ai` main at commit `2f50effef624570b6e686d71caa6d430f77a467f`, plus the intake pilot, the `AndMar` primary agent, and the verification-evidence changes documented in the changelog. Current behavior is described by [SCOPE.md](SCOPE.md) and the generated [CAPABILITIES.md](CAPABILITIES.md).

The core evolution (Intake → Work Ledger → lifecycle → checkpoints →
Completion → development metrics → Delivery) is complete at `v0.16.0`; real
use should now drive measured-friction improvements, bug fixes and
simplifications rather than a new capability.

`bun run check` runs the architecture check, typecheck and the pure
deterministic suite. Treat any test count as revision-bound: the current
value is whatever `bun run check` prints in your checkout (282 tests on the
`v0.16.0` release, which added deterministic work unit tracking).

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
blockers and requirement evidence survive restarts via plugin storage, and
`status` re-projects them compactly after compaction. Work Ledger recovery
covers the portable side: `WORK.md` is read before restarting from scratch,
and the deterministic lifecycle helper restores unit state. What is still
deliberately missing is cross-session takeover: `andmar_resume` intentionally
enforces parent-session ownership for delegated child sessions. A brand-new
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

## Behavioral benchmark (before any new capability)

With the Task Contract core implemented, the next capability is frozen
until a small benchmark compares harness value on real tasks:

```text
OpenCode plain + same model  vs  AndMar + same model
```

The opt-in lateral implementation, eight initial fixtures, native usage collection,
fairness checks and historical comparison instructions are now canonical in
[bench/README.md](../bench/README.md). `bun run check` includes deterministic
benchmark tests and a mock CLI E2E; real LLM runs remain explicit/manual.

Expand the initial fixtures to 10–20 real tasks (mix of trivial, feature, bugfix,
migration) before drawing broad conclusions. Process is fixed: evidence → human analysis →
proposed change → human approval → implementation. Results never mutate
the harness automatically (see D-019).

## Real OpenCode smoke record (2026-09-22)

Executed via `opencode run --standalone --agent andmar` in a scratch CLI
project (`node greet.js`), multi-requirement task: add `--json`, keep the
default output, update tests, update README, touch nothing else, run the
real CLI smoke, verify through the harness.

```text
smoke 1 (default free model): contract created with 7 requirements, all
  preserved; receipts + verify ok; gate DENIED (pending REQ-7); agent
  reported honestly "not formally complete" instead of a false done —
  the negative path (green tests ≠ completion) proven in real runtime.

smoke 2 (same model): contract correctly refused an illegal
  satisfied->blocked transition; honest blocked report again.

smoke 4 (pinned stronger model, after runChildTask fix): full positive
  path — contract created (6 explicit requirements), evidence recorded
  sequentially, receipts + verify ok, completion gate ok:true and closed the
  contract in the same call, final report 6/6 requirements with honest
  limitations.
```

This record predates the removal of the independent-review subsystem. The
negative and positive paths it established (green tests ≠ completion;
evidence + gate closes the contract atomically) are the current contract;
see [DECISIONS.md](DECISIONS.md).

## Real API typecheck vs offline check

`bun run check` is the authoritative repository check. After `bun install`, it typechecks against the pinned real `@opencode/plugin` package.

For environments without registry/network access, `bun run check:offline` exists only as a structural fallback and uses the local type shim. A passing offline check is **not** evidence of OpenCode API compatibility and must never replace `bun run check` in CI or release validation.


## Work Unit lifecycle regression coverage

`tests/work-unit-lifecycle.test.ts` exercises the repository-native Work Unit lifecycle helper against real `WORK.md` files. Coverage includes pending→active, active→done with declared evidence, automatic/explicit next-unit selection, blocking/resume, explicit reopen, rollback on invalid evidence, completed-ledger immutability, and preservation of structural validity. `tests/install-dev.test.ts` also executes the lifecycle helper through the installed global AndMar plugin path from an unrelated consumer repository.

## Work Unit checkpoint regression coverage

`tests/work-unit-checkpoint.test.ts` uses real temporary Git repositories. It covers exact verified-revision gating, metadata-only skip behavior, deterministic commit trailers, current-HEAD recording, rejection of mismatched Work Unit trailers, idempotent SHA recording, and stale checkpoint clearing on reopen. Work Ledger validator tests cover malformed/non-done/duplicate checkpoint references. `tests/install-dev.test.ts` executes the checkpoint helper through the installed global plugin path as a consumer-repository smoke.


## Engram lateral integration regression coverage

`tests/engram-integration.test.ts` verifies JSONC/OpenCode config discovery, effective precedence for partial overrides, agent-profile detection, fail-open startup semantics, runtime-observed availability, and metadata-only memory observability. `tests/engram-setup.test.ts` verifies that AndMar delegates configuration to the upstream-owned `engram setup opencode` command instead of rewriting MCP configuration itself. The suite intentionally does not mock Engram as completion evidence because memory is advisory.


## Work tracking

`tests/work-tracking.test.ts` exercises scope paths/globs/symlink escapes,
structured observations and before-call WU attribution, shell VCS/hash
reconciliation, deduplication/no-op writes, concurrent helper mutations,
necessary-work policy, durable exception blocking, restart/rebinding, optional
RPC failure, existing Verification/Completion integration and Intake trivial
bypass. Native hooks/VCS/RPC are fixtures here; these tests are not live OpenCode
proof. The portable helper operates on real temporary repository files.

On an installed OpenCode V2, smoke: initialize and bind a Ledger from Intake,
create its Task Contract, complete WU1, let WU2 discover low-risk necessary work
and append it, perform native edits/shell changes, inspect touched/drift,
record exact-revision verification, satisfy obligations, close via the existing
Completion gate, then finalize. Separately flag a material discovery, confirm
native mutation/execution cannot continue while blocked, resolve only after
an actual user decision, and resume. Finally try `Login` -> `Entrar` unbound:
no Ledger/contract, no VCS tracking, no question, no mandatory TUI.


## Checkpoint/Resume audit — 0.16.0 base, 2026-10-01 UTC

Base: `44a24f0` (`main`, 0.16.0). The first regression commit ran against
unchanged production code: **37 tests, 29 pass, 8 fail**. It reproduced outer
Code Mode deadlock, response/rebind ordering, missing block boundary and
ambiguous legacy recovery. After the minimal fix, the focused suite is
**41/41** and the full `bun run check` is **295/295**, including real installed
plugin typechecking. No dependency, Review, Task Contract/Verification/Gate
change, version bump or publication was made.

| Scenario | Deterministic regression | Native CLI evidence |
|---|---|---|
| A amendment human decision | PASS | PASS, real amendment to blocked |
| B material scope | PASS | Same classification; fixture |
| C CLI block | PASS | PASS, native shell invokes real helper |
| D response before bind | PASS | PASS after server restart |
| E response after bind | PASS | Fixture |
| F interleaved reads/status/RPC | PASS | Reads and repeated status before resume |
| G outer execute → work_resume | PASS | PASS, real Code Mode child |
| H outer execute → mutation | PASS | Native write child refused; no forbidden file |
| I local/namespaced aliases | PASS | Native canonical andmar.work_resume observed |
| J restart/rehydration | PASS | Server restarted, durable Ledger retained |
| K repeated status | PASS | PASS, no second confirmation |
| L resume → shell/edit | PASS | PASS, touched result.txt attributed to WU-1 |
| M verification/completion/finalize | PASS | PASS, exact-revision receipt, gate ok, completed |
| N trivial fast path | PASS, zero checkpoint/VCS IO | Fixture counters |
| O separate Ledgers/session bindings | PASS | Real files, runtime fixture |

Pure tests additionally reject older/equal/unknown temporal evidence, validate
encoded/native DateTime and ID-only legacy order, reject stale/duplicate
boundary fields and compare an exact boundary under the write lock. A duplicate
resume cannot emit another state transition. Existing trivial Intake and
Verification/Completion authority tests remain green.

### Live runtime method and results

Installed `@opencode/cli-linux-x64@2.0.20`; `opencode --version` returned
`opencode v2.0.20`. With an isolated `OPENCODE_CONFIG_DIR`, ran
`bun run install:dev` and `bun run doctor`: plugin/agent/API/CLI checks passed;
Engram absent and optional. Actual `opencode serve` plus `opencode run --server`
used a local OpenAI-compatible provider with scripted responses. This replaces
only model generation: the plugin host, interpreter, permissions, hooks,
sessions/user messages, storage, native filesystem/Git and helpers were real.
No paid tokens or reviewer were used. It does not test an LLM's interpretation
of ambiguous human text or the interactive TUI.

A temporary Git repository held a real Ledger and Task Contract. Tested an
amendment human checkpoint, then a native CLI block checkpoint, with and without
a native server restart. A later CLI user prompt authorized local delivery.
The runtime bound the blocked Ledger, read it, inspected status repeatedly,
resumed once, refused a duplicate, ran native shell/edit, made a local Git
commit, computed the real working-state revision, ran an actual assertion,
stored an observed exact-command receipt, verified, satisfied the obligation,
completed all WUs, passed Completion Gate with `contractClosed:true`, and
finalized to `Status: completed`. No push, remote delivery, manual repair,
second authorization, retry or release was needed.

To test concrete child mutators, a **smoke-only** native tool transform set
edit/write/read to `codemode:true`; production defaults were unchanged.
A write child under a blocked outer execute was refused and `forbidden.txt`
was not created. The successful final flows retained default direct shell,
so each native check had its own call ID.

### Remaining boundary and candidate validation

Global Code Mode HTTP bypasses native tool hooks in OpenCode 2.0.20, as proved
against a harmless local endpoint while the Ledger remained blocked. Checkpoints
control subsequent observed tools; they do not cancel running effects or provide
a security/network sandbox. No source rewriting or duplicated permissions were
added to claim otherwise.

The shared-child evidence regression is fixed in 0.16.1-rc.1. New tests exercise
parallel children, wrapper exclusion, retained revision-bound receipts, restart,
a later failed execution and a fresh rerun for a new revision. Local OpenCode
acceptance and stable promotion are not recorded in this repository; they stay
an explicit decision taken on a real session.

Candidate 0.16.1-rc.1 validation: `bun run check` passed 296/296 tests against
installed plugin types. `install:dev` and doctor passed after backing up the
previous agent (the installer deliberately refuses to overwrite a different
agent). Real 2.0.20 completion passed for both direct shell/helper block and
multiple shell children in one execute/amendment, with server restart before
response and rebind. Shared-child receipts were distinct, Verification and
Completion Gate passed, Ledger finalized, and blocked write stayed absent.
The local provider supplied scripted model responses; this proves native
integration, not free-form LLM interpretation or interactive TUI behavior.
