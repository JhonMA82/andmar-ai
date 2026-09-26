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

No allowlist or resolver enforces this yet; it is a review rule, not a gate.
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
`worktree-provider` are not part of the current MVP. The narrow `jev-decisions`
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

**Work Ledger = repository-native operational artifact** (`.andmar/work/<work-id>/`), not a capability. It uses OpenCode native file tools and Git portability rather than plugin storage (`ctx.storage`) or capability code. Work Unit state transitions are handled by a small deterministic script (`scripts/work-ledger-lifecycle.mjs`) rather than a workflow runtime. See [WORK-LEDGER.md](WORK-LEDGER.md) and [DECISIONS.md](DECISIONS.md) D-027/D-029.


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
Lifecycle (`andmar_change_impact` for docs/version obligations)
   ↓
Independent review (`andmar_request_review`: deterministic `none | audit | deep`
   ↓     routing, fresh frontier child session per round restricted to
         read/glob/grep when available, sanitized compact evidence-audit
         packet, max two rounds)
Completion (`andmar_completion_gate`: exact-revision evidence +
   requirement gate + approved current review + clean lifecycle
   gates + satisfied required verification)
```

There is intentionally no generic Workflow engine between these steps: each
transition is an explicit primitive call by the agent, and the completion gate
is the only composition point. See D-015 for why Workflow stays deferred.

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
worktrees               (the MVP does not override worktrees; a future
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
- code review requiring broad reasoning.

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

A future memory capability must not overload these keys or change their semantics.

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
     +-- independent review approved for the current revision (when required)?
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

The MVP only computes likely impact:

```text
none | patch | minor | major
```

It intentionally does not mutate `package.json`, create tags or publish releases. That belongs in a future release capability only if repeated use demonstrates the need.

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
                 task-contract (obligations + review)
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
