# Evidence-Driven Roadmap

This is not a promised feature list. Each item has a trigger. Do not implement an item merely because it appears here.

**Scope:** forward-looking triggers only. What already exists is the generated
inventory ([CAPABILITIES.md](CAPABILITIES.md)) plus
[ANDMAR-AI-CAPABILITIES.md](ANDMAR-AI-CAPABILITIES.md); what is deliberately
excluded is [MVP-SCOPE.md](MVP-SCOPE.md). This document is canonical for
*triggers*, not for current behavior.

## 0.1 — Current MVP

Already implemented; see [CAPABILITIES.md](CAPABILITIES.md) for the generated
id/version/tool inventory and [ANDMAR-AI-CAPABILITIES.md](ANDMAR-AI-CAPABILITIES.md)
for behavior. The distinctive pieces are:

- capability loader and durable state;
- deterministic model profiles;
- delegation/resume;
- documentation/version impact and the exact-revision completion gate;
- verification receipts bound to observed execution evidence;
- intake request-refinement pilot (deterministic-first, one typed Jev
  decision, explicit non-blocking fallback);
- Task Contract behavioral core: per-session obligation record
  (`andmar_task_contract`), requirement-gated completion, and bounded fresh
  independent review (`andmar_request_review`, max two rounds).

## Candidate: workflow capability

**Trigger:** repeated manual orchestration in ODD or other methodologies.

The session-scoped Task Contract (implemented, see DECISIONS D-016) covers
per-session obligations, steering, post-compaction recovery and bounded
review; it is deliberately not a workflow engine and does not by itself
trigger this candidate.

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

## Implemented (pilot): intake request refinement

Previous trigger was "a measurable set of decisions that structured rules cannot classify reliably enough" for one narrow question: whether a request needs refinement before execution. The `intake` capability answers it with deterministic checks first and a single typed Jev call second (`andmar_intake` / `andmar_intake_trace`), with an explicit non-blocking fallback. Broader Jev uses below remain candidates.

## Candidate: worktree strategy adapter

**Trigger:** parallel workers repeatedly spend significant time rebuilding ignored dependencies/caches.

Evaluate Lane/copy-on-write before building a custom strategy.

## Candidate: Herdr observability adapter

**Trigger:** native OpenCode UI is insufficient for parallel worker visibility.

Adapter must remain optional and event-driven; harness logic must work without it.

## Candidate: release capability

**Trigger:** version/changelog detection is reliable but manual updates remain a recurring source of release errors.

Start with deterministic local mutations only. Publishing/PR automation is a separate later decision.

## Explicit non-roadmap

These require a new architectural decision before implementation:

- multi-runtime compatibility;
- general vector memory;
- autonomous self-improving agent mesh;
- generic enterprise workflow platform;
- custom provider/model abstraction.
