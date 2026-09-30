# Architecture

## 1. Architectural thesis

AndMar AI should remain a **policy + capability layer** over OpenCode V2.

OpenCode owns execution mechanics. AndMar AI owns a small set of constraints and reusable primitives that are difficult to enforce reliably with prompts alone.

Documentation is part of the architecture contract: code, generated manifests,
tests, configuration and documentation must describe the same system, and no
architectural rule is restated where it can be generated or referenced from
one canonical source. The rule itself lives in
[../AGENTS.md](../AGENTS.md); the document ownership split is §2.3 below.

```text
Methodologies / skills / user intent
                |
                v
           OpenCode V2
  sessions, tools, permissions, storage,
   models, VCS, worktrees, skill discovery,
   event stream
                |
                v
           AndMar AI
       stable deterministic core
                |
         capability modules
                |
   native OpenCode execution (shell, tools,
   sessions, permissions, VCS) — unchanged
```

AndMar never replaces OpenCode machinery. See §2.4 for the explicit list.

## 2. What belongs where

### OpenCode V2

- session lifecycle;
- model catalog/provider connectivity;
- permission system;
- shell/tool execution;
- storage primitive;
- VCS/worktree APIs;
- event delivery;
- prompt/model hooks.

AndMar AI must use these APIs rather than wrap or reproduce them.

### Core (`src/core/`)

Only stable cross-capability primitives:

```text
config
state adapter
capability loader / setup
model policy
generic path matching
deterministic lifecycle helpers
small shared contracts
```

The core should be **stable and boring**. Frequent product features in core
indicate a boundary problem.

> If a normal feature requires modifying `src/core`, first demonstrate why it
> cannot live in a capability or a skill.

No allowlist or resolver enforces this yet; it is an architectural rule, not a gate.
Concretely, ODD, Product Plan, release flows, UI, Herdr, Jev, Lane and
provider-specific prompts must never land in core.

### Capabilities

> **Capability = a generic guarantee integrated into the runtime.**

Capabilities live in one folder each, `src/capabilities/<id>/`, and register
their own OpenCode hooks and tools during `setup`.

Valid examples of the kind of problem a capability solves:

- observing executions;
- durable operational state;
- exact-revision evidence;
- parent/child ownership;
- completion gates.

Current inventory (generated, never hand-edited):
[CAPABILITIES.md](CAPABILITIES.md). Per-capability behavior:
[ANDMAR-AI-CAPABILITIES.md](ANDMAR-AI-CAPABILITIES.md). Integration rules:
[CAPABILITY-CONTRACT.md](CAPABILITY-CONTRACT.md).

Future examples such as `workflow`, `context-projection` or
`worktree-provider` are not part of the current system; they are
measured-friction candidates. The narrow `jev-decisions`
extension point is implemented as the `intake` pilot (typed Jev answers only,
no free text).

### Skills

> **Skill = knowledge or procedure that the model loads through OpenCode's
> native mechanism.**

A skill may contain references, scripts and assets. It carries no runtime
guarantees: it does not register hooks, does not own state and does not gate
completion.

**Having scripts does not turn a skill into a capability.**

### Scripts

> **Script = deterministic specialized automation, invoked by a skill or by
> repository tooling.**

Scripts run with the repository's normal tooling (`scripts/*.mjs`, package
scripts). They are the right home for deterministic work that needs no hook,
no durable state and no permission boundary.

### Rule: capability vs skill

```text
Can it be solved correctly with repository artifacts or skill + script,
using the generic guarantees that already exist?

    Yes -> do not create a capability.

    No: it needs runtime integration, state, hooks, ownership or a gate
        -> evaluate a capability.
```

**Work Ledger = repository-native operational artifact** (`.andmar/work/<work-id>/`), not a capability. It uses OpenCode native file tools and Git portability rather than plugin storage (`ctx.storage`) or capability code. Work Unit state transitions are handled by a small deterministic script (`scripts/work-ledger-lifecycle.mjs`) rather than a workflow runtime. Recoverable Work Unit commits use a second small two-phase helper (`scripts/work-unit-checkpoint.mjs`): AndMar validates exact-revision readiness and records the resulting SHA while OpenCode remains the Git executor. See [WORK-LEDGER.md](WORK-LEDGER.md) and [DECISIONS.md](DECISIONS.md) D-027/D-030.


The same test exists in executable form in
[ANDMAR-AI-CAPABILITIES.md](ANDMAR-AI-CAPABILITIES.md) ("Boundary test for a
new capability"); if a candidate capability needs broad core edits, the
boundary is wrong.

### Methodologies

ODD, Product Plan, request-refiner and future skills are **consumers** of
primitives. They are not runtime infrastructure.

```text
ODD
 |- delegate
 |- verify
 |- completion gate
 `- future workflow primitive
```

AndMar core must not know the name `ODD`.

### 2.1 Primary-agent surface

The optional `AndMar` Markdown agent is a user-facing OpenCode profile, not a capability and not another runtime.

```text
Build  -> native OpenCode execution
Plan   -> native OpenCode planning
AndMar -> native OpenCode execution + harness completion policy
```

The agent may call `routing`, `verification`, `lifecycle`, and `delegation` primitives, but the actual implementation work remains native OpenCode tool execution. Removing the agent must not break the harness capabilities, and removing the harness must not alter Build/Plan behavior.

### 2.2 Current request flow (real contracts, not a future Workflow)

For a non-trivial request handled by the `AndMar` agent today:

```text
Request
   ↓
Intake (`andmar_intake`: deterministic first, one typed Jev decision when useful,
   ↓    explicit non-blocking fallback; modes: direct, enrich, structure)
Work Projection (intake signals `workProjection.mode`: none | lightweight | structured)
   ↓
Optional repository Work Ledger (`.andmar/work/<work-id>/`: portable continuity source,
   ↓    lossless requirements and deterministic Work Unit lifecycle; see docs/WORK-LEDGER.md)
Task Contract runtime projection (`andmar_task_contract create`: goal, bounded requirements,
   ↓     constraints, verification surface; trivial edits skip it; later user instructions `steer` it;
         `status` recovers it after compaction — compaction never ends the task)
Routing (`andmar_route`: deterministic minimum profile from
   ↓     TaskSignals; intake `routeSignals` reused, same taxonomy)
Execution / Delegation (native OpenCode tools; `andmar_delegate`
   ↓     only for bounded child tasks, `andmar_resume` by handle)
Verification (`andmar_suggest_checks` → run via native shell
   ↓     → `andmar_record_receipt` bound to observed execution
     → `andmar_verify_revision` for the exact revision;
       requirement evidence recorded per Task Contract requirement)
Lifecycle (`andmar_change_impact` for docs/version obligations;
   ↓     `andmar_work_status` / `andmar_work_amend` / `andmar_work_resume` bind Work Units)
   ↓
Completion (`andmar_completion_gate`: exact-revision evidence +
  requirement gate + clean docs/version obligations + satisfied required
  verification)
```

No second LLM judges completion. The independent-review subsystem was
removed; completion is decided by explicit Task Contract obligations plus
deterministic exact-revision evidence.

There is intentionally no generic Workflow engine between these steps: each
transition is an explicit primitive call by the agent, and the completion gate
is the only composition point. See D-015 for why Workflow stays deferred.

`development-metrics` sits outside this request flow. It subscribes to the existing metadata-only semantic-event primitive and exposes `andmar_report` only for explicit harness diagnostics/tuning; it is not another execution step or gate. Work Ledger recovery counts are read only from `.andmar/work/*/WORK.md`. See [DEVELOPMENT-METRICS.md](DEVELOPMENT-METRICS.md) and D-033.

### 2.3 Documentation ownership

Documentation ownership follows the same boundary rule as code:

```text
capability owns its behavioral documentation
generated index owns inventory
overview/architecture only explain the system
```

- Behavioral, per-capability truth lives with the capability's canonical
  section in [ANDMAR-AI-CAPABILITIES.md](ANDMAR-AI-CAPABILITIES.md) (enforced
  by `check-architecture.mjs`) and in that topic's specialized document.
- The inventory (`id`, `version`, `description`, tools) is generated into
  [CAPABILITIES.md](CAPABILITIES.md) and is never hand-edited.
- [OVERVIEW.md](OVERVIEW.md) explains the product and the flow;
  this document explains boundaries and data flow. Neither carries
  per-capability detail.
- Everything else links to the canonical source instead of restating it.

Moving behavioral documentation physically into each capability folder is a
deliberate future decision, not part of the current layout.

### 2.4 Not duplicating OpenCode

AndMar does **not** implement, and must not build:

```text
skill registry          (OpenCode owns discovery, registry, loading,
                         progressive disclosure)
tool registry           (tools register via ctx.tool.transform; OpenCode
                         owns the namespace and execution)
permissions             (OpenCode permission hooks stay authoritative;
                         children inherit the parent's rules)
session runtime         (delegation creates native child sessions)
provider/model catalog  (AndMar stores ModelRef values already valid in
                         OpenCode, and never guesses an ID)
VCS                     (revision capture uses explicit fingerprints;
                         there is no parallel VCS layer)
worktrees               (AndMar does not override worktrees; a future
                         adapter would use ctx.worktree.transform())
```

AndMar also runs no subprocesses of its own: checks and mutations go through
native OpenCode shell/tools, and AndMar only observes, records and gates. See
[OPENCODE-V2.md](OPENCODE-V2.md) for the API assumptions behind each line.

## 3. Determinism boundary

Every decision should be classified as one of:

### Hard/deterministic

Examples:

- max delegation depth;
- permission inheritance;
- shell timeout ceiling;
- revision equality;
- docs path mapping;
- model profile floor for explicit high-risk task kinds.

These belong in code.

### Hybrid

Examples:

- whether a vaguely described change is security-sensitive;
- whether a semantic API change is breaking;
- whether old context still matters.

The narrowest slice of this is implemented: the `intake` pilot answers seven
typed Jev questions per request, and deterministic constraints still validate
the result. Broader semantic classification still waits for measured friction.

### Semantic/frontier

Examples:

- architecture design;
- hard debugging;
- implementation;
- user-requested code review requiring broad reasoning.

These belong to a capable model, selected through the model policy.

## 4. Model policy

Capabilities do not choose vendors. They request profiles.

```text
TaskSignals
    |
    v
minimumProfile()
    |
    +--> fast
    +--> standard
    `--> frontier
              |
              v
      configured ModelRef
```

Safety rule:

```text
requested profile >= deterministic minimum
```

If no concrete model is configured, delegation inherits the parent session model. The harness never invents a provider/model ID.

## 5. Delegation model

Delegation is a primitive, not an agent taxonomy.

```text
parent session
      |
      v
andmar_delegate
      |
      +-- depth check
      +-- model profile
      +-- native child session
      +-- inherited permissions
      +-- durable WorkerRecord
      |
      v
child result (bounded)
```

The child transcript remains in the child session. The parent receives a bounded result plus `sessionID`. Further work uses `andmar_resume(sessionID, ...)`.

Ownership is recorded under the parent. Resume is rejected when the child does not belong to the caller.

## 6. Operational state

Operational facts use `ctx.storage`. The key families, their owners, readers
and lifecycle are enumerated in [STATE.md](STATE.md) — that document is
canonical for state ownership; this section only fixes the boundary:

```text
runtime/...                      workers/...
journal/...                      verification*/...
intake-trace/...                 task-contract*/...
```

This is not long-term semantic memory. It is durable execution state.

Persistent memory never overloads these keys or changes their semantics:
Engram (`src/integrations/engram/`) is historical advisory context outside
`ctx.storage`, and Work Ledger state lives in the repository instead.

## 7. Completion model

A worker saying “done” creates a **candidate completion**, not final completion.

```text
implementation
     |
     v
verification evidence (observed execution + revision match)
     |
     +-- revision matches current revision?
     +-- passed receipts backed by completed same-revision execution?
     +-- tests passed?
     +-- every Task Contract requirement satisfied/blocked/skipped with evidence?
     +-- revision-bound requirement evidence current (not stale)?
     +-- docs clean/updated?
     `-- version/changelog clean/updated?
     |
     v
completion gate
```

A worker saying “done” still creates only a candidate completion, and
passing tests prove only what those tests cover. Changing the revision
makes earlier evidence stale — including requirement evidence. A
`passed: true` claim without observed execution evidence is reported as
`unverified`, never as proof; a `satisfied` requirement without evidence
is invalid, never as completion.

For Ledger-backed work, portable readiness is checked first through
`work-ledger-lifecycle.mjs status` (`completionReady:true`). The runtime
completion gate then derives verification truth from stored evidence;
callers supply only the final revision, task kind, lifecycle docs/version status,
and the relevant required checks. A successful gate closes the Task Contract in
the same operation. The portable Ledger is then finalized with the same accepted
revision. This removes the old gate-seal-then-close ceremony without creating a
second completion subsystem.

Cross-capability verification reads use the minimal shared
`core/verification-state` read contract. `verification` remains the sole writer
of receipts/evidence; `task-contract` consumes the derived exact-revision status
without importing a sibling capability or duplicating storage ownership.

## 7.1 Delivery boundary

Delivery is the final core coordination layer, not a Git/release subsystem. `andmar_delivery` reads the current raw user instruction and the current Task Contract status, then returns whether one named operation is authorized and ready. It never executes the operation.

```text
completed work / explicit operational continuation
        |
        v
andmar_delivery(operation)
  +-- named by current user?
  +-- explicitly negated?
  `-- Task Contract completed (when present)?
        |
        v
OpenCode native Git / PR / tag / publish / release tools
```

Authorization never expands transitively: commit does not imply push, push does not imply PR, PR does not imply merge, and version does not imply tag/publish/release. Work Unit checkpoint commits remain a separate local recovery policy. This closes the planned core evolution; future additions require demonstrated friction and should remain lateral extensions.

## 8. Documentation integrity

Mappings live in configuration:

```text
code patterns -> documentation patterns
```

The harness identifies possible staleness; the LLM/human decides the content to write. This avoids auto-generating low-value documentation.

The option shape, defaults and matcher syntax live in
[CONFIGURATION.md](CONFIGURATION.md); the mapping-driven rule is in
[../AGENTS.md](../AGENTS.md).

## 9. Versioning integrity

AndMar only computes likely impact:

```text
none | patch | minor | major
```

It does not mutate `package.json`, create tags or publish releases itself. The `delivery` capability gates authorization/readiness for those named operations; OpenCode still performs any requested mutation natively.

The policy and release procedure live in [VERSIONING.md](VERSIONING.md).

## 10. Scalability mechanism

Capabilities are discovered at build/dev time by `scripts/generate-capability-manifest.mjs`.

Adding a capability should not require a central handwritten registry. The generated manifest is the only aggregation point and is never manually maintained.

This provides explicit imports for predictable packaging while avoiding runtime filesystem magic.

## 11. Failure philosophy

Different risks use different failure modes:

- optimization failure -> **fail open** (keep information / inherit model);
- safety or external mutation uncertainty -> **fail closed**;
- missing model mapping -> inherit parent instead of guessing;
- max delegation depth -> stop delegating and resolve directly.

## 12. Future composition

The intended future shape is:

```text
                    OpenCode V2
                         |
                     AndMar core
                         |
     +-----------+-------+---------+-------------+
     |           |                 |             |
 delegation   verification      lifecycle     routing
     |           |                 |             |
     +-----------+--------+--------+-------------+
                         |
                 task-contract (obligations + completion gate)
                          |
                  optional workflow
                         |
       ODD / Product Plan / other skills

Optional adapters / sinks:
context projection | Lane | Herdr | semantic observability (/events)

Jev is not an adapter: one typed Decisions call lives inside `intake`.
```

The semantic observability sink is best-effort and content-free: routing,
delegation, verification and completion may emit bounded metadata to a local
`POST /events` endpoint, but no capability depends on delivery succeeding.
OpenCode runtime events remain owned by OpenCode/its observability plugin.

The optional pieces must remain removable without breaking the core.


## Integrations

> **Integration ≠ Capability.** A capability is a runtime guarantee AndMar
> owns; an integration only connects an external system.

Integrations are optional external adapters and are not capabilities. They may discover/configure an external system, expose bounded status, add agent guidance, or emit observability metadata, but they cannot become completion/readiness guarantees unless a future architectural decision explicitly promotes that responsibility.

An integration:

- connects a system that lives outside AndMar;
- is optional and removable without touching the core or a capability;
- may fail open: its unavailability or failure never blocks execution,
  Completion or Delivery;
- does not participate in Completion or Verification automatically;
- does not acquire core authority: no new state ownership, no new completion
  rule, no new tool namespace.

The first concrete integration is `src/integrations/engram/`. Engram owns persistent memory and native MCP tools; AndMar owns only the boundary described in [ENGRAM.md](ENGRAM.md). The presence of `integrations/` does not create a generic Integration framework; extract one only after another real integration demonstrates shared semantics.


### Portable execution observation

Lifecycle owns small scope diagnostics alongside its existing Work Ledger
helper, rather than introducing a Plan entity or another capability. Native
hooks observe edits and transient VCS dirty-file hashes for bound Ledger work;
metadata is recorded in the existing WU. Existing helpers still own WU
transitions, Task Contract still owns obligations, Verification still owns
exact-revision evidence and Completion still owns closure. There is no Review
or second LLM evaluation. The shared glob primitive is plain ESM so installed
native CLI helpers and TypeScript capabilities use the same rules without a
loader or new dependency.

A derived read-only native RPC projection prepares future presentation.
Activity is ephemeral, work is repository-native, and RPC availability is
advisory. Intake is the sole entry classifier and trivial unbound work skips
tracking. Exact behavior and limits live in [WORK-LEDGER.md](WORK-LEDGER.md).
