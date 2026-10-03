# Real-world testing

**Scope:** how to install the development build for real use, the test matrix
that should drive the next capability, and the current limitations. The
system-level explanation is [OVERVIEW.md](OVERVIEW.md); the architecture is
[ARCHITECTURE.md](ARCHITECTURE.md). Current behavior is described by
[SCOPE.md](SCOPE.md) and the generated [CAPABILITIES.md](CAPABILITIES.md).

The core evolution (Intake → Work Ledger → lifecycle → checkpoints →
Completion → development metrics → Delivery) is complete; real use should now
drive measured-friction improvements, bug fixes and simplifications rather
than a new capability.

`bun run check` runs the architecture check, typecheck and the pure
deterministic suite. Treat any test count as revision-bound: the current value
is whatever `bun run check` prints in your checkout.

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

Keep new procedures in native skills and scripts; add a capability only for a demonstrated runtime guarantee. Do not add a generic workflow engine. Do not add an AndMar memory subsystem or memory capability: Engram is the existing optional external memory integration (see [ENGRAM.md](ENGRAM.md)), and it never becomes work state or completion evidence. (The narrow `intake` Jev pilot is already implemented; broader semantic uses still wait for evidence.)

| Scenario | Example | What to observe |
|---|---|---|
| Trivial | README/text change | AndMar stays lightweight and does not create ceremony |
| Bug fix | Fix a known failing test | Relevant checks run and evidence is tied to final working state |
| Feature | Small bounded feature | Routing/delegation add value only when useful |
| Migration/integration | Port a plugin to current OpenCode V2 | Upstream contract + runtime boundary + CI are checked, not only mocks |
| Restart | Stop OpenCode during a real task and return | Recover active work through structured status/context |

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
covers the portable side: structured status/context restores active unit state
without injecting full Markdown into the model. What is still
deliberately missing is cross-session takeover: `andmar_resume` intentionally
enforces parent-session ownership for delegated child sessions. A brand-new
parent session therefore must not silently take ownership of an old child.

Continuity improvements stay within the existing repository state, session binding
and native skill surfaces; they do not require another workflow subsystem.

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
the harness automatically (see D-018).

## Real OpenCode smoke: what it must establish

Run real smokes through `opencode run --standalone --agent andmar` in a scratch
CLI project. The paths that must hold in a real runtime are the two below; they
are enforced deterministically by `tests/task-contract.test.ts` and must also be
observed against a live OpenCode before trusting a change to them.

```text
negative: green tests + a pending requirement -> gate DENIED and the agent
  reports "not formally complete" instead of a false done
  (green tests != completion)

positive: requirements satisfied with exact-revision evidence -> gate ok:true
  and the Task Contract closed in the same call
  (evidence + gate closes the contract atomically)
```

A real smoke must also observe: an illegal `satisfied -> blocked` transition is
refused, and the final report states the requirement count with honest
limitations.

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


## Checkpoint/Resume regression coverage

`tests/work-tracking.test.ts` covers the checkpoint and resume scenarios below
deterministically. Column two is what a real OpenCode smoke must additionally
observe, because the test harness uses fixtures for the native hook, VCS and RPC
surfaces.

| Scenario | Deterministic regression | Native CLI smoke must show |
|---|---|---|
| A amendment human decision | yes | a real amendment moves the unit to blocked |
| B material scope classification | yes | same classification as the fixture |
| C native CLI block | yes | native shell invokes the real helper |
| D response before bind | yes | works after a server restart |
| E response after bind | yes | covered by fixture |
| F interleaved reads/status/RPC | yes | repeated reads and status before resume |
| G outer execute -> `work_resume` | yes | a real Code Mode child resumes |
| H outer execute -> mutation | yes | a native write child is refused; the forbidden file is not created |
| I local/namespaced tool aliases | yes | the canonical `andmar.work_resume` is observed |
| J restart/rehydration | yes | after a server restart the durable Ledger is retained |
| K repeated status | yes | no second confirmation is demanded |
| L resume -> shell/edit | yes | the touched file is attributed to the resumed unit |
| M verification/completion/finalize | yes | exact-revision receipt, gate ok, Ledger finalized |
| N trivial fast path | yes, zero checkpoint/VCS IO | covered by fixture counters |
| O separate Ledgers/session bindings | yes | real files, runtime fixture |

Pure tests additionally reject older, equal and unobservable temporal evidence,
reject stale or duplicate boundary fields, and compare an exact boundary under
the Ledger write lock. A duplicate resume cannot emit another state transition.

### How to smoke without paid tokens

Use a local OpenAI-compatible provider with scripted responses. This replaces
only model generation: the plugin host, interpreter, permissions, hooks,
sessions and user messages, storage, native filesystem/Git and the helpers stay
real. A temporary Git repository can hold a real Ledger and Task Contract. This
method does not test an LLM's interpretation of ambiguous human text or the
interactive TUI.

To exercise concrete child mutators, a **smoke-only** native tool transform can
set edit/write/read to `codemode:true`; production defaults are unchanged. A
write child under a blocked outer execute must be refused.

### Known runtime boundaries

- Global Code Mode HTTP can bypass native tool hooks on the installed OpenCode
  build, as proved against a harmless local endpoint while the Ledger remained
  blocked. Checkpoints control subsequent observed tools; they do not cancel
  running effects and are not a security or network sandbox. No source
  rewriting or duplicated permissions are added to claim otherwise.
- Within one `execute`, several shell children can share the outer call ID.
  AndMar keeps the native ID for the first observation and allocates
  `observed-<sha256(nativeId)>-<ordinal>` for the rest, so receipts stay
  distinct. `tests/verification.test.ts` covers parallel children, wrapper
  exclusion, retained revision-bound receipts, restart, a later failed
  execution and a fresh rerun for a new revision.

Stable promotion is a decision taken on a real session; it is not recorded as a
procedure in this repository.

## Final modular native acceptance

Run `bun run acceptance` (or `bun run check`, then `bun run test:runtime`) with an installed OpenCode V2
binary (`OPENCODE_BIN` selects a specific binary). The script creates an isolated
Git project/config/data directory, starts the actual server and drives native
shell, write/read, skill and Code Mode tools with a deterministic model fixture.
No external model credential or new repository dependency is needed. Nothing is
mocked at the tool/hook/storage/receipt boundary. Temporary state is removed by
default; `ANDMAR_KEEP_ACCEPTANCE=1` retains it for diagnostics. An optional first
script argument selects the JSON report path; default `.andmar/runtime-acceptance.json`.

Assertions require native exit 0, stored same-session receipt referencing the
real call ID, successful Verification and Gate, native exit 7 with passed-receipt
refusal, product-state mutation with stale Verification/Gate rejection, and read/
Ledger repair/product-shell refusal/recovery for duplicate EV, invalid WU and
unknown REQ. All three recover in one session without restart. requiredChecks
contains `custom`; an empty set never hides association failures.

Native skill discovery is asynchronous and also picks up skills installed for
the host, so readiness waits for the packaged AndMar skills resolved inside the
fixture config directory, not for an unrelated skill count. The report's
`discovered` paths must all point into the fixture config.

Verified on installed OpenCode 2.0.21. The fixture validates mechanical runtime
contracts, not model judgment, semantic skill adoption on arbitrary tasks or
unhooked global fetch sandboxing. Unit tests independently cover serialization,
parallel evidence allocation, compact context/status, stamp invalidation and
checkpoint boundaries. Do not treat test counts alone as semantic acceptance.

## PR #10 closure acceptance

The same acceptance driver installs the canonical packaged primary agent into
the isolated native `agents` path, queries the installed `/api/agent` inventory,
selects `andmar` on session creation and requires successful native
`skill({id:"andmar-work-ledger"})` execution. The previous discovery-only check
could miss an invocation error; successful tool completion is now asserted.
Packaged skill IDs still come from assets/skills and every resolved skill path
must belong to the fixture config. Host skills cannot satisfy readiness.

After recording one done WU and leaving the next active, the driver stops the
real server, starts a new process with the same durable project/config/data,
creates a new AndMar session and explicitly binds through work_status. It checks
WU-2 active/WU-1 done, loads targeted context, continues WU-2, gates/finalizes and
checks that the WU-1 completion event occurred only once. No Ledger is recreated
for continuation, and no entire Ledger is copied into plugin storage.

The checkpoint scenario uses a real material amendment, refused native write/
shell, successful native read and repeated status, then a refused work_resume
with the old user message. A subsequent real prompt creates a new user message;
its observed timestamp must be later than durable Checkpoint At before resume
and product mutation can succeed. Test code does not synthesize session events
or timestamps. The scripted model chooses calls, not their outcomes.

The isolated environment has no configured Engram; native AndMar status must
report unavailable advisory integration while execution continues. No Engram
installation or evidence substitute is used. Intake classification stays in
tests/intake.test.ts; it is not replayed as heavy runtime acceptance.

Architecture regression tests introduce actual owner inversions, relative
sibling imports, duplicate tools, parallel agent sources, incomplete native
skills, proprietary registries, functional legacy and stale generated output
inside temporary fixtures. The read-only checker must refuse each. The shared
generator is the single serializer for exact manifest/version/index comparisons.

The acceptance report is revision-local operational evidence under .andmar,
not packaged historical state. Output announces each native phase. The fixture
validates machine/runtime boundaries, not semantic LLM judgment, interactive TUI
quality or upstream global-fetch permission isolation.

## Learning and Runtime Incident acceptance

The native driver also executes npm test failure → source correction → same-command
success, checks one pending lesson and zero project-failure incidents, records and
resolves each corrupt Ledger incident before continuing Verification/Completion,
explains a real server restart with last/next WU references, and explicitly
promotes/invokes an ordinary project skill through the native scanner. Catalog
fetch and updates are disabled; the only model is the local deterministic fixture.
`tests/learning-incidents.test.ts` additionally covers sanitation, recurrence,
explicit cancellation/external outcomes, recorder failure, atomic publication
reconciliation, ownership and a stalled catalog refresh without a tool deadlock.
