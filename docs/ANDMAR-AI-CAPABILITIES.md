# AndMar AI — Capabilities Guide

This document is the compact source for deciding whether a concern belongs in a capability, a policy, a workflow, or a skill.

## Principles

AndMar AI is capability-oriented, not agent-oriented. OpenCode V2 owns execution, sessions, permissions, models, VCS, worktrees, and UI. AndMar adds small reusable constraints and stateful primitives only where prompts are not reliable enough.

Rules:

1. Prefer deterministic code, schemas, metadata, VCS, hashes, state, and events.
2. A capability should be self-contained and should not import sibling capabilities.
3. Installed does not mean activated.
4. Never escalate authority beyond the parent session.
5. Durable operational state belongs in `ctx.storage`, not in semantic memory.
6. Add a capability only for demonstrated friction.

## Implemented capabilities

### `system`

Status, bounded shell timeout, and lightweight durable tool journal.

### `routing`

Deterministic minimum model profile:

```text
fast -> standard -> frontier
```

Capabilities request profiles, never hard-coded provider/model names.

### `delegation`

Bounded native OpenCode child sessions with ownership, depth, model profile, durable handles, and resume.

### `lifecycle`

Documentation impact, version impact, and exact-revision completion gate.

### `verification`

Verification **does not execute tests, lint, typecheck, or builds itself**. It preserves OpenCode permissions by:

- deterministically suggesting relevant checks from project signals;
- observing real executions via the stable `execute.after` hook and keeping minimal evidence (metadata only);
- recording outcomes produced through native OpenCode execution, with approved receipts bound to their observed `executionId`;
- binding receipts and evidence to an exact revision/fingerprint;
- rejecting missing, failed, stale, or unverified evidence.

Tools:

```text
andmar_suggest_checks
andmar_record_receipt
andmar_verify_revision
```

A receipt proves that a recorded check passed for a supplied revision **with observed execution evidence**. `passed: true` alone is never evidence. It does not prove that the test itself was sufficient.

## AndMar primary agent

`AndMar` is not a capability. It is a custom OpenCode primary agent that applies the existing primitives as a completion policy while still using native OpenCode tools for implementation.

```text
Build  -> plain OpenCode
Plan   -> analysis
AndMar -> OpenCode + AndMar guarantees
```

The agent intentionally remains model-agnostic.

## Candidate capabilities

Candidates are evidence-driven, not a build queue.

### `workflow`

Trigger: repeated real-world friction coordinating task state, completion contracts, resume, or bounded review/correction loops.

Start small. The first implementation should solve the observed problem before adding generic DAGs or a workflow DSL.

### `decision`

Trigger: recurring semantic choices that deterministic rules cannot classify reliably. A small classifier such as Jev may be appropriate for classify/score/choose decisions, never as a general reasoning replacement.

### `context`

Trigger: measured repeated token/context waste. Deterministic retention first, semantic classification only if needed, fail-open to full context.

### `workspace`

Trigger: parallel writers need isolation beyond native OpenCode worktrees or repeatedly pay meaningful cache/setup cost.

### `impact-analysis`, `docs-integrity`, `release`, `git-policy`, `budget`, `observability`, `recovery`

Add only when the corresponding friction is demonstrated.

### `memory`

Low priority for the harness. Memory is not operational state, history, or context. Prefer an external OpenCode memory plugin unless AndMar-specific semantics become necessary.

## Boundary test for a new capability

Before adding one, ask:

```text
1. Does OpenCode V2 already solve it?
2. Does an existing package/plugin solve it?
3. Can a small deterministic function solve it?
4. Is the behavior reusable across projects/tasks?
5. Does it need durable state?
6. Could it simply be a skill/prompt?
7. Can an existing capability be extended without coupling responsibilities?
```

If a normal capability requires broad core edits, re-evaluate the boundary.

## Anti-patterns

Avoid:

```text
one capability per command
one capability per agent
capability importing capability
hard-coded model IDs
LLM routing every decision
automatic activation of everything
general DAG before evidence
memory used as task state
verification that bypasses OpenCode permissions
worker self-report treated as completion proof
```

The governing rule remains:

> Add only the next capability that resolves a measured friction.
