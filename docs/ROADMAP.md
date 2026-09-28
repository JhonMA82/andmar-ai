# Evidence-Driven Roadmap

This is not a promised feature list. Each item has a trigger. Do not implement an item merely because it appears here.

**Scope:** forward-looking triggers only. What already exists is the generated
inventory ([CAPABILITIES.md](CAPABILITIES.md)) plus
[ANDMAR-AI-CAPABILITIES.md](ANDMAR-AI-CAPABILITIES.md); what is deliberately
excluded is [SCOPE.md](SCOPE.md). This document is canonical for
*triggers*, not for current behavior.

## Current baseline — v0.15.0

The planned core evolution is **complete**:

```text
Intake -> Work Ledger -> work-unit lifecycle -> work-unit checkpoints
-> Completion simplification -> development metrics -> Delivery
```

There is no Step 9. See [CAPABILITIES.md](CAPABILITIES.md) for the generated
id/version/tool inventory (9 capabilities, 14 tools) and
[ANDMAR-AI-CAPABILITIES.md](ANDMAR-AI-CAPABILITIES.md) for behavior. The
distinctive pieces are:

- capability loader and durable state;
- deterministic model profiles;
- delegation/resume;
- documentation/version impact and the exact-revision completion gate;
- verification receipts bound to observed execution evidence;
- intake request-refinement pilot (deterministic-first, one typed Jev
  decision, explicit non-blocking fallback);
- repository-native Work Ledger with deterministic Work Unit lifecycle and
  two-phase checkpoint gate;
- evidence-derived completion: `andmar_completion_gate` derives
  verification truth from stored evidence and closes the Task Contract in the
  same operation;
- Task Contract behavioral core: per-session obligation record
  (`andmar_task_contract`) and requirement-gated completion, with no
  independent-review subsystem;
- bounded development metrics (`andmar_report`), diagnostic only;
- delivery authorization/readiness (`andmar_delivery`), execution native;
- Engram as an optional lateral integration outside the capability
  inventory.

## How future work is classified

Every item outside the baseline above is one of:

```text
bug fix
simplification
measured-friction improvement
skill
script
external integration
isolated capability   (only when a runtime guarantee requires it)
```

Nothing is scheduled by appearing in this file; each candidate below still
needs its trigger to fire in real use.

## Candidate: workflow capability

**Trigger:** repeated manual orchestration in ODD or other methodologies.

The session-scoped Task Contract (implemented, see DECISIONS D-016) covers
per-session obligations, steering and post-compaction recovery; it is
deliberately not a workflow engine and does not by itself trigger this
candidate.

First implementation should expose only:

```text
sequence
parallel
gate
repeat(maxRounds)
```

No nested workflow language, arbitrary scripting or swarm mesh.

## Candidate: context projection

**Trigger:** measured repeated token/context waste from old tool results.

Order:

1. deterministic retention rules;
2. metrics/dry-run;
3. optional small semantic classifier;
4. cache classification decisions;
5. fail open to full context.

## Candidate: broader Jev decisions

**Trigger:** a measurable set of decisions beyond intake that structured rules cannot classify reliably enough.

Potential uses:

- ambiguous model profile selection;
- relevance scoring;
- small gates/choices.

Jev must not become an agent or general reasoning substitute.

## Implemented: verification receipts

Previous trigger was "completion gate inputs become repeatedly manual". The `verification` capability now provides structured receipts (`andmar_record_receipt` / `andmar_verify_revision`) captured from native OpenCode shell/tool execution, with exact-revision semantics. Revision capture itself still takes the revision as explicit input; automating it from native VCS events remains a candidate.

## Implemented: completion simplification

The completion boundary now consumes those stored receipts plus Task Contract requirement evidence. Normal callers provide the exact revision, task kind, docs/version status and proportional required checks; they no longer repeat a `testsPassed` boolean. A successful `andmar_completion_gate` closes the Task Contract in the same serialized operation. Ledger-backed work uses `completionReady:true` before the gate and `work-ledger-lifecycle.mjs finalize --revision ...` afterward to preserve portable final revision/timestamp without adding another runtime completion subsystem.

## Implemented (pilot): intake request refinement

Previous trigger was "a measurable set of decisions that structured rules cannot classify reliably enough" for one narrow question: whether a request needs refinement before execution. The `intake` capability answers it with deterministic checks first and a single typed Jev call second (`andmar_intake` / `andmar_intake_trace`), with an explicit non-blocking fallback. Broader Jev uses below remain candidates.

## Candidate: worktree strategy adapter

**Trigger:** parallel workers repeatedly spend significant time rebuilding ignored dependencies/caches.

Evaluate Lane/copy-on-write before building a custom strategy.

## Candidate: Herdr observability adapter

**Trigger:** native OpenCode UI is insufficient for parallel worker visibility.

Adapter must remain optional and event-driven; harness logic must work without it.

## Implemented: delivery boundary

The final planned core step is implemented as a narrow authorization/readiness gate. `andmar_delivery` never performs Git, PR, tag, publish, merge or release actions; OpenCode executes only the operation explicitly named by the current user. No general release automation subsystem is planned without new measured friction.

## Core evolution is closed

The eight-step path above is finished; future roadmap items are lateral
extensions, bug fixes, simplifications, measured-friction improvements,
skills, scripts, or isolated capabilities — none of them implies another
core phase. New core behavior requires a new architectural decision plus
real measured friction.


## Implemented lateral integration: Engram persistent memory

Engram is integrated outside the core/capability inventory. OpenCode uses native Engram MCP tools and Engram-provided MCP instructions; AndMar contributes only authority, bounded retrieval/save policy, status and metadata-only metrics. Memory never becomes current work state or completion evidence. See [ENGRAM.md](ENGRAM.md).

## Explicit non-roadmap

These require a new architectural decision before implementation:

- multi-runtime compatibility;
- an AndMar memory subsystem or memory capability (persistent memory stays
  with the optional Engram integration);
- general vector memory;
- autonomous self-improving agent mesh;
- generic enterprise workflow platform;
- custom provider/model abstraction.
