# AGENTS.md — AndMar AI

This file is the authoritative implementation guidance for coding agents working on this repository.

## Mission

AndMar AI is a **thin, deterministic-first harness for OpenCode V2**. It extends OpenCode; it must not become a second runtime

Documentation is part of the architecture contract.

Code, generated manifests, tests, configuration and documentation must describe the same system.

Do not duplicate architectural truth across files when it can be generated or referenced from one canonical source.

A capability change is incomplete when its public contract, state ownership, configuration, integrations or verification behavior changed without the corresponding documentation update.

## Non-negotiable architecture rules

1. **OpenCode V2 only.** Do not add Pi, Gentle-AI, V1 or multi-runtime abstractions.
2. **Deterministic before LLM.** If a decision can be made with code, schemas, metadata, VCS, hashes, events or explicit policy, do that first.
3. **Minimum sufficient model.** Workflows request `fast`, `standard` or `frontier`, never concrete model names.
4. **No authority escalation.** A delegated child must never gain permissions the parent did not have.
5. **Worker report is not proof of completion.** Completion requires independent evidence.
6. **Evidence is revision-bound.** A code change invalidates evidence from an older revision.
7. **Unknown mutation result is not permission to retry.** Reconcile external reality before repeating side effects.
8. **State != context != memory.** Operational state belongs in `ctx.storage`; do not create memory machinery to solve execution-state problems.
9. **Capabilities are isolated.** Normal features live under `src/capabilities/<id>/` and communicate through core contracts, not imports from sibling capabilities.
10. **Do not edit generated manifests manually.** Run `bun run generate`.
11. **Do not bypass OpenCode shell/permission primitives.** If execution would evade OpenCode permission hooks, redesign it.
12. **No speculative infrastructure.** Add a capability only for a demonstrated problem or an explicit current requirement.

## Extension test

A normal new capability should require:

- one new `src/capabilities/<id>/` folder;
- optional tests/docs/config additions;
- regenerated manifest.

If it requires edits across more than 2–3 existing modules, stop and re-evaluate the boundary. A core change is justified only when a genuinely new primitive is required by multiple capabilities.

## Core ownership

`src/core/` may contain only stable cross-capability primitives:

- contracts and metadata;
- config resolution;
- state adapter;
- capability setup;
- model policy;
- deterministic lifecycle helpers;
- small generic utilities.

Do not put ODD, Product Plan, release flows, UI, Herdr, Jev, Lane or provider-specific prompts into core.

## Capability contract

Every capability exports:

```ts
const capability: Capability = {
  id: "...",
  version: 1,
  description: "...",
  async setup(runtime) {
    // register OpenCode V2 hooks/tools/transforms
    // return cleanup if needed
  },
}
```

Setup must be repeatable in intent, bounded and explicit about resources it owns.

## Model policy

Use `minimumProfile()` and `clampRequestedProfile()`.

Do not hard-code model IDs inside capabilities. Concrete model selection comes only from configuration:

```text
fast     -> configured fast model or parent model
standard -> configured standard model or parent model
frontier -> configured frontier model or parent model
```

A capability may raise the requested profile for safety; it must not lower the deterministic minimum.

## Routing philosophy

The current deterministic policy is intentionally conservative:

- low-risk local UI/docs/known-test/internal work can be `fast`;
- ordinary bounded work is `standard`;
- architecture, security, migrations, hard debugging, high reasoning and repeated failure are `frontier`.

Do not add a semantic router until real ambiguous routing cases demonstrate the need. The narrow implemented slice is the `intake` pilot (one typed Jev decision on whether a request needs refinement), not a frontier-model router.

## Documentation map (read before changing)

`AGENTS.md` is the operational contract, not the architecture. Consult the
canonical source for the area you touch:

```text
what AndMar is / product flow     -> docs/OVERVIEW.md
architecture / boundaries / data flow  -> docs/ARCHITECTURE.md
adding or changing a capability        -> docs/CAPABILITY-CONTRACT.md
  + canonical per-capability reference -> docs/ANDMAR-AI-CAPABILITIES.md
  + generated id/version/tool index    -> docs/CAPABILITIES.md (never edit)
state keys / ownership / lifecycle     -> docs/STATE.md
options / environment variables        -> docs/CONFIGURATION.md
receipts / evidence / revision binding -> docs/VERIFICATION.md
intake / Jev / trace / fallback        -> docs/INTAKE.md
request flow / completion policy       -> assets/agents/andmar.md
why the architecture is this way       -> docs/DECISIONS.md
what is in / out of the MVP            -> docs/MVP-SCOPE.md
real-world testing (Bun flow)          -> docs/TESTING.md
version / changelog policy             -> docs/VERSIONING.md
OpenCode V2 API assumptions            -> docs/OPENCODE-V2.md
```

Before changing architecture, read `ARCHITECTURE.md`,
`CAPABILITY-CONTRACT.md`, the affected capability documentation, and the
relevant decisions.

When changing a capability:

- preserve capability isolation (no sibling imports);
- update tests alongside the behavior they verify;
- update manifest metadata (`id`/`version`/`description`) when applicable and
  regenerate (`bun run generate`);
- update `STATE.md` / `CONFIGURATION.md` when state or options are affected;
- update the canonical `### \`<id>\`` section in
  `docs/ANDMAR-AI-CAPABILITIES.md`;
- update `CHANGELOG.md` when the change is user-visible;
- run the complete project gate (`bun run check`).

## Documentation/versioning

Documentation impact is mapping-driven. Do not spread filename-specific conditions through the codebase.

Version impact is a gate, not an automatic release system. The MVP reports the likely SemVer class from explicit change metadata and public-surface paths. It does not publish releases.

Any behavior change to the harness itself must update at least one of:

- `README.md` for human-facing behavior;
- `AGENTS.md` for agent rules;
- `docs/ARCHITECTURE.md` for boundaries/data flow;
- `docs/DECISIONS.md` for an architectural decision.

Avoid documentation churn for internal refactors that do not alter behavior or extension contracts.

## Verification

Before claiming a repository change is complete:

1. run deterministic tests/checks available for the change;
2. establish the current revision/working state;
3. ensure evidence belongs to that exact revision;
4. evaluate documentation impact;
5. evaluate version/changelog impact when public surface changed;
6. only then report completion.

Never treat the implementing agent's statement as evidence.

## What not to build without evidence

Do not add by default:

- general DAG workflow DSL;
- recursive/nested workflows;
- swarm chat;
- vector memory;
- file leases;
- custom terminal dashboard;
- model-provider abstraction layer;
- autonomous PR/release publication;
- generic plugin framework on top of the capability framework.

## Source of truth priority

When implementation and docs disagree:

1. OpenCode V2 official API contract;
2. tests/invariants in this repository;
3. `docs/DECISIONS.md`;
4. `AGENTS.md`;
5. README/examples.

Fix stale lower-priority documentation in the same change.
