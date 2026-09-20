# Evidence-Driven Roadmap

This is not a promised feature list. Each item has a trigger. Do not implement an item merely because it appears here.

## 0.1 — Current MVP

- capability loader;
- durable state;
- deterministic model profiles;
- delegation/resume;
- documentation/version impact;
- exact-revision completion gate.

## Candidate: workflow capability

**Trigger:** repeated manual orchestration in ODD or other methodologies.

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

## Candidate: Jev decisions

**Trigger:** a measurable set of decisions that structured rules cannot classify reliably enough.

Potential uses:

- ambiguous model profile selection;
- relevance scoring;
- small gates/choices.

Jev must not become an agent or general reasoning substitute.

## Candidate: verification receipts

**Trigger:** completion gate inputs become repeatedly manual.

Add structured receipts captured from native OpenCode shell/tool/VCS events. Preserve exact-revision semantics.

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
