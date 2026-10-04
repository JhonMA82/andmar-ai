# Delivery

Delivery is AndMar's final core boundary. It answers two questions for one named operation:

1. did the current user explicitly authorize this operation?
2. is the current task ready to leave the completion boundary?

It does **not** execute the operation.

## Tool

```text
andmar_delivery({ operation })
```

Operations:

```text
commit | push | pull-request | merge | tag | version | publish | release
```

The capability reads the latest raw user message directly from the OpenCode session. There is no caller-provided `authorized` flag.

## Rules

- Authorization is operation-specific.
- Explicit negation fails closed.
- `"termina la feature"` authorizes no delivery operation.
- `"haz commit y push"` authorizes commit and push, not PR/merge/tag/release.
- `"haz los 3 commits"` authorizes commit: an explicit counted request is still an explicit request. Operation nouns are plural-tolerant and a verb phrase (`haz`/`hacer`, `crea`/`crear`, `make`/`create`) tolerates a short determiner/quantifier run before the noun. The run never crosses a clause boundary, so per-clause negation still governs.
- A bare abbreviation such as `"pr"` authorizes nothing without an explicit open/create verb.
- An active or blocked Task Contract denies delivery.
- A completed Task Contract is delivery-ready.
- If no Task Contract exists, an explicitly requested operational/trivial continuation may proceed, but OpenCode must inspect native repository state before execution.
- Ambiguous target/scope is resolved with OpenCode's native user interaction, not by Delivery.
- Work Unit checkpoint commits remain governed by `delivery.workUnitCommits` and do not imply remote/release authorization.

### Checkpoint commits are not this gate

`andmar_delivery` is the **post-completion** boundary. A mid-work checkpoint commit is a different thing with its own path, and routing it through `andmar_delivery` is a mistake that ends in a correct refusal:

```text
work-unit-checkpoint.mjs prepare <ledger> <WU> --revision <sha>   # validate against exact revision
<native Git commit>
work-unit-checkpoint.mjs record <ledger> <WU> --commit <sha>      # store HEAD in the Ledger
```

The helper never stages, commits, pushes, merges, tags or releases. `prepare` validates the Ledger, refuses when Git conflicts exist or when there are no product changes, requires `--revision` to equal the current computed working-state revision (a stale revision is rejected), and returns a ready-to-commit message without staging anything. `record` then requires the checkpoint commit to be current HEAD and stores that SHA. This path reads the Work Ledger and is independent of `andmar_delivery`, so an active Task Contract does not block it.

So when `andmar_delivery({ operation: "commit" })` returns `ready: false` with an incomplete Task Contract, the answer is to use the checkpoint path — or to finish the completion flow first — **not** to commit anyway. Overriding a deterministic gate that has not approved is the failure this gate exists to prevent.

## Execution boundary

After `allowed:true`, OpenCode executes the requested operation with native Git/VCS/provider tools and verifies the resulting state proportionally. AndMar does not stage, commit, push, open PRs, merge, tag, publish, or release by itself.

## Core freeze

With Delivery implemented, the planned core path is complete. New behavior should prefer skills, scripts, adapters, or isolated capabilities and should require measured friction before changing core guarantees.
