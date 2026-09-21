# Architecture

## 1. Architectural thesis

AndMar AI should remain a **policy + capability layer** over OpenCode V2.

OpenCode owns execution mechanics. AndMar AI owns a small set of constraints and reusable primitives that are difficult to enforce reliably with prompts alone.

Documentation is part of the architecture contract.

Code, generated manifests, tests, configuration and documentation must describe the same system.

Do not duplicate architectural truth across files when it can be generated or referenced from one canonical source.

A capability change is incomplete when its public contract, state ownership, configuration, integrations or verification behavior changed without the corresponding documentation update.

```text
```text
OpenCode V2
    ↓
AndMar primary agent (optional user-facing profile, not a runtime)
    ↓
AndMar capabilities (thin policy + evidence primitives)
    ↓
OpenCode native execution (shell, tools, sessions, permissions, VCS)
```

AndMar never replaces OpenCode machinery. Concretely, AndMar does **not**
replace or re-implement:

```text
runtime            (sessions, tool execution, event delivery)
shell              (AndMar runs no subprocesses; it only caps timeouts)
permissions        (OpenCode permission hooks stay authoritative)
sessions           (delegation creates native child sessions)
VCS                (revision capture uses explicit fingerprints, no parallel VCS)
models             (OpenCode owns the provider/model catalog)
native execution   (checks run through OpenCode tools; AndMar only observes)
```

Methodologies / skills / user intent
                |
                v
           OpenCode V2
  sessions, tools, permissions, storage,
   models, VCS, worktrees, event stream
                |
                v
           AndMar AI
       stable deterministic core
                |
         capability modules
```

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

### AndMar core

Only cross-capability contracts:

```text
config
state
capability loader
model policy
generic path matching
lifecycle primitives
```

The core should be boring. Frequent product features in core indicate a boundary problem.

### Capabilities

Self-contained OpenCode integrations:

```text
system
routing
delegation
lifecycle
verification
intake
```

Future examples may include `workflow`, `context-projection`, or `worktree-provider`, but they are not part of the current MVP. The narrow `jev-decisions` extension point is now implemented as the `intake` pilot (typed Jev answers only, no free text).

### Methodologies

ODD, Product Plan, request-refiner and future skills are consumers. They are not runtime infrastructure.

```text
ODD
 |- delegate
 |- verify
 |- completion gate
 `- future workflow primitive
```

AndMar core must not know the name `ODD`.

## 2.1 Primary-agent surface

The optional `AndMar` Markdown agent is a user-facing OpenCode profile, not a capability and not another runtime.

```text
Build  -> native OpenCode execution
Plan   -> native OpenCode planning
AndMar -> native OpenCode execution + harness completion policy
```

The agent may call `routing`, `verification`, `lifecycle`, and `delegation` primitives, but the actual implementation work remains native OpenCode tool execution. Removing the agent must not break the harness capabilities, and removing the harness must not alter Build/Plan behavior.

## 2.2 Current request flow (real contracts, not a future Workflow)

For a non-trivial request handled by the `AndMar` agent today:

```text
Request
   ↓
Intake (`andmar_intake`: deterministic first, one typed Jev
   ↓    decision when useful, explicit non-blocking fallback;
        `needsRefinement=true` → Internal Task Brief by the primary model)
Routing (`andmar_route`: deterministic minimum profile from
   ↓     TaskSignals; intake `routeSignals` reused, same taxonomy)
Execution / Delegation (native OpenCode tools; `andmar_delegate`
   ↓     only for bounded child tasks, `andmar_resume` by handle)
Verification (`andmar_suggest_checks` → run via native shell
   ↓     → `andmar_record_receipt` bound to observed execution
     → `andmar_verify_revision` for the exact revision)
Lifecycle (`andmar_change_impact` for docs/version obligations)
   ↓
Completion (`andmar_completion_gate`: exact-revision evidence +
   clean lifecycle gates + satisfied required verification)
```

There is intentionally no generic Workflow engine between these steps: each
transition is an explicit primitive call by the agent, and the completion gate
is the only composition point. See D-015 for why Workflow stays deferred.

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

The narrowest slice of this is implemented: the `intake` pilot answers six
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

Operational facts use `ctx.storage`:

```text
runtime/...
workers/<parent>/<child>
worker-by-session/<child>
journal/...
verification-evidence/<executionId>
verification/<revision>/<check>
intake-trace/<timestamp>-<rand>
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
     +-- review passed if required?
     +-- docs clean/updated?
     `-- version/changelog clean/updated?
     |
     v
completion gate
```

Changing the revision makes earlier evidence stale. A `passed: true` claim
without observed execution evidence is reported as `unverified`, never as
proof.

## 8. Documentation integrity

Mappings live in configuration:

```text
code patterns -> documentation patterns
```

The harness identifies possible staleness; the LLM/human decides the content to write. This avoids auto-generating low-value documentation.

## 9. Versioning integrity

The MVP only computes likely impact:

```text
none | patch | minor | major
```

It intentionally does not mutate `package.json`, create tags or publish releases. That belongs in a future release capability only if repeated use demonstrates the need.

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
                  optional workflow
                         |
       ODD / Product Plan / other skills

Optional adapters:
context projection | Lane | Herdr

Jev is not an adapter: one typed Decisions call lives inside `intake`.
```

The optional pieces must remain removable without breaking the core.
