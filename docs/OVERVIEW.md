# Overview — what AndMar is and how a task really runs

This is the second document in the reading path:

```text
README.md  ->  docs/OVERVIEW.md  ->  docs/ARCHITECTURE.md
```

`README.md` gives the short version. This document explains the product view:
what problem AndMar solves, which pieces exist, how one request actually flows
today, and how skills and capabilities relate to each other. Boundaries,
ownership and data flow live in [ARCHITECTURE.md](ARCHITECTURE.md); this
document does not repeat them.

## 1. The problem it solves

> Take one request all the way to a consistent repository, using OpenCode for
> the execution, and add only the guarantees that prompts alone cannot reliably
> provide.

An agent that is told "do this well" usually does most of it. The repeated,
measurable failures are not code-quality failures — they are consistency
failures:

- the code ends up correct but the repository is left inconsistent;
- documentation that should have changed with the code is forgotten;
- version/changelog obligations are reported and then ignored;
- verification is claimed for work that happened before the last edit;
- the user's actual requirements quietly disappear during execution;
- review is either skipped or run without proportion to risk;
- delegation loses ownership or quietly raises authority.

AndMar exists to make those specific things impossible-by-construction instead
of discouraged-by-prompt. Everything else stays with OpenCode.

## 2. Components

```text
OpenCode V2
    │
    ├── sessions
    ├── tools
    ├── permissions
    ├── models
    ├── VCS / worktrees
    └── native skill discovery
             │
             ▼
          AndMar
             │
      thin runtime guarantees
             │
    ┌────────┼────────┐
    ▼        ▼        ▼
capabilities skills  scripts
```

Ownership:

| Layer | Owns |
|---|---|
| OpenCode V2 | the runtime: sessions, tool execution, permissions, storage, model catalog, VCS, worktrees, skill discovery/loading |
| AndMar core | minimal infrastructure and contracts: config, state adapter, capability loader, model policy, small shared helpers |
| Capabilities | generic runtime guarantees integrated with OpenCode hooks/tools/state |
| Skills | knowledge and procedures, loaded by the model through OpenCode's native skill mechanism |
| Scripts | deterministic specialized automation, invoked by a skill or by repository tooling |

AndMar does not replace any OpenCode layer. It observes, records and gates
around work that OpenCode already executes.

## 3. The real flow today

This is the flow as it exists now for a non-trivial request handled by the
`AndMar` agent. It is a sequence of explicit primitive calls, **not** a
workflow engine: no step runs unless the agent calls it, and the completion
gate is the only place where the steps compose.

```text
request
   ↓
intake            (andmar_intake)
   ↓                deterministic first; one typed Jev decision when useful;
   ↓                fallback never blocks; trivial wording bypasses Jev
   ↓                canonical modes: direct, enrich (operational brief), structure (Work-Ledger projection)
task contract     (andmar_task_contract create)
   ↓                goal, requirements (REQ-N), constraints (CON-N);
   ↓                skipped entirely for trivial edits
   ↓                later instructions `steer`; `status` recovers it after compaction
routing           (andmar_route)
   ↓                deterministic minimum profile from task signals;
   ↓                called only when a routing/delegation decision is needed
execution         (native OpenCode tools)
   ↓                andmar_delegate / andmar_resume only for bounded child tasks;
   ↓                the child never gains authority the parent lacked
verification      (andmar_suggest_checks -> run -> andmar_record_receipt
   ↓                -> andmar_verify_revision, all bound to the exact revision)
lifecycle         (andmar_change_impact: documentation and version obligations)
   ↓
independent review (andmar_request_review: none | audit | deep, max two rounds)
   ↓                skipped when routing resolves to `none`
completion        (andmar_completion_gate)
```

### Which steps are conditional

| Step | When it is skipped or reduced |
|---|---|
| intake / Jev call | invalid or trivial requests bypass Jev deterministically; any Jev failure degrades to a non-blocking `fallback` |
| task contract | trivial typo/text/question/reading/local-reversible edits |
| routing | when no routing or delegation decision is actually needed |
| delegation | normal work stays in the primary session with native tools |
| verification | `requiredChecks: []` only for tasks that genuinely require no checks; otherwise receipts must exist for the exact current revision |
| independent review | deterministic routing resolves trivial/non-code work to `none`; review also needs an open non-completed contract |
| completion gate | never skipped for non-trivial work; it is the only composition point |

There is intentionally no workflow engine, scheduler or orchestration board
between these steps (see [DECISIONS.md](DECISIONS.md) D-015). Each transition
is a call the agent makes, and `andmar_completion_gate` decides whether the
obligations were actually met.

## 4. A complete example

Request: **"Add a new option to the CLI."**

```text
1. intake
      classify into direct, enrich, or structure; build an operational brief if underspecified

2. obligations
      task contract records the explicit requirements, including the
      ones that are easy to forget (docs, tests, no unrelated changes)

3. execution
      implement with native OpenCode tools; delegate only if a bounded
      child task genuinely benefits from separate context

4. tests / typecheck
      run the relevant checks through OpenCode's shell, then record a
      receipt per check bound to the exact working-state revision

5. affected documentation
      change_impact maps the changed paths to documentation obligations
      and reports which documents are likely stale

6. version impact
      change_impact classifies none | patch | minor | major; it detects
      the obligation and never bumps, tags or publishes anything

7. review, if it applies
      one fresh read/search-only child session audits the diff, the
      requirements and the evidence; routing decides none | audit | deep

8. completion
      the gate accepts only when verification, every requirement with
      evidence, the required review and the docs/version obligations
      are all current for the same revision
```

No step above assumes the agent's own claim. "Implementation finished" is a
candidate completion; only the gate decides.

## 5. What happens with skills

OpenCode V2 is the owner of the skill lifecycle:

- discovery;
- registry;
- loading;
- progressive disclosure.

AndMar **does not maintain a parallel skill registry**. It has no skill index,
no skill schema and no skill validator. A correctly installed skill is
discoverable and loadable by OpenCode without editing any AndMar file.

Skills carry knowledge and procedures — how to approach a kind of work. They
may bundle their own references, scripts and assets. Methodologies such as ODD
are consumers of AndMar primitives; AndMar core does not know their names.

## 6. What happens with capabilities

- A capability lives in one folder: `src/capabilities/<id>/`.
- The registration manifest is generated by `bun run generate`
  (`src/generated/capabilities.ts`) and the objective index
  (`docs/CAPABILITIES.md`) is generated with it. Neither is hand-edited.
- A normal capability requires **no** core change: folder, tests, docs,
  regenerate.
- A capability exists only when the problem needs runtime guarantees —
  hooks, observed execution, durable state, ownership, evidence or gates —
  that a skill plus a script cannot provide sufficiently on its own.

The decision rule is in [ARCHITECTURE.md](ARCHITECTURE.md); the integration
contract is [CAPABILITY-CONTRACT.md](CAPABILITY-CONTRACT.md); the inventory is
the generated [CAPABILITIES.md](CAPABILITIES.md).

## 7. Where to look next

| Question | Document |
|---|---|
| boundaries, ownership, data flow | [ARCHITECTURE.md](ARCHITECTURE.md) |
| capability inventory and tools | [CAPABILITIES.md](CAPABILITIES.md) (generated) |
| adding or changing a capability | [CAPABILITY-CONTRACT.md](CAPABILITY-CONTRACT.md), [EXTENDING.md](EXTENDING.md) |
| per-capability behavior | [ANDMAR-AI-CAPABILITIES.md](ANDMAR-AI-CAPABILITIES.md) |
| options and environment variables | [CONFIGURATION.md](CONFIGURATION.md) |
| state keys and ownership | [STATE.md](STATE.md) |
| receipts, evidence, revision binding | [VERIFICATION.md](VERIFICATION.md) |
| intake, Jev, trace, fallback | [INTAKE.md](INTAKE.md) |
| testing and current limitations | [TESTING.md](TESTING.md) |
| version and changelog policy | [VERSIONING.md](VERSIONING.md) |
| why the architecture is shaped this way | [DECISIONS.md](DECISIONS.md) |
| what is in and out of the MVP | [MVP-SCOPE.md](MVP-SCOPE.md), [ROADMAP.md](ROADMAP.md) |
| OpenCode V2 API assumptions | [OPENCODE-V2.md](OPENCODE-V2.md) |
| agent rules for coding agents | [../AGENTS.md](../AGENTS.md) |
