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
- An active or blocked Task Contract denies delivery.
- A completed Task Contract is delivery-ready.
- If no Task Contract exists, an explicitly requested operational/trivial continuation may proceed, but OpenCode must inspect native repository state before execution.
- Ambiguous target/scope is resolved with OpenCode's native user interaction, not by Delivery.
- Work Unit checkpoint commits remain governed by `delivery.workUnitCommits` and do not imply remote/release authorization.

## Execution boundary

After `allowed:true`, OpenCode executes the requested operation with native Git/VCS/provider tools and verifies the resulting state proportionally. AndMar does not stage, commit, push, open PRs, merge, tag, publish, or release by itself.

For GitHub destinations the execution path is layered by proximity to the platform (see D-037):

```text
AndMar pipeline (intake / route / work-unit / verify / review / completion)
        -> andmar_delivery(operation)        authorization + readiness only
        -> official OpenCode GitHub surface  execution + credentials
        -> thin deterministic adapter        artifact shaping + reconciliation
        -> GitHub                            destination
```

- **Official OpenCode GitHub surface:** the GitHub Action `anomalyco/opencode/github`, the GitHub App `opencode-agent` (`opencode github install`) and its OIDC / `GITHUB_TOKEN` conventions, documented at `opencode.ai/docs/github/`. It is event-triggered and runs OpenCode inside GitHub Actions runners; there is no official outbound GitHub PR/release API, so outbound mutations run through native OpenCode Git/`gh` tools under those token conventions.
- **Thin deterministic adapter:** a lateral extension (documented conventions plus a scripts/skill surface), not a capability and not a Git client. It makes each externally visible artifact deterministic: branch slug, commit trailers, PR title/body and release-note sections derived from the portable Work Ledger, the Task Contract and `CHANGELOG.md`.
- **Not owned by the adapter:** authorization, credentials, provider calls, retries, or resulting state.

Operational rules at that boundary:

- The adapter never grants or widens authority; a denied operation has no adapter path.
- An unknown mutation result is reconciled against real repository/PR state before any retry.
- A missing or unconfigured official surface is a reported limitation, and the operation stops.

## Core freeze

With Delivery implemented, the planned core path is complete. New behavior should prefer skills, scripts, adapters, or isolated capabilities and should require measured friction before changing core guarantees.
