# AndMar AI

**Deterministic-first harness for OpenCode V2.**

AndMar AI is named after **Andrea + Mario**. The name is intentionally broader than “AndMar Harness”: the harness is the first product, while the name can survive future capabilities without renaming the project.

> Status: **MVP** — intentionally small. The goal is to establish stable extension points and runtime invariants before adding more automation.

## Why this exists

AndMar AI is not another agent runtime and it is not a port of Gentle-AI. OpenCode V2 already owns sessions, tools, permissions, storage, model catalogs, hooks, VCS and worktrees. AndMar AI adds a thin policy/capability layer for the frictions that are better solved outside prompts:

- deterministic model routing so trivial work does not automatically consume frontier models;
- durable operational state that survives context changes;
- bounded child-session delegation;
- verification evidence tied to an exact revision;
- documentation and versioning impact checks;
- capability modules that scale without editing the core in many places.

## Design rule

The project follows this order of preference:

1. **Deterministic code** — schemas, metadata, Git/VCS state, hashes, events and explicit rules.
2. **Small semantic decision model** — Jev, only when a rule cannot decide cleanly.
3. **Frontier model** — reasoning, design, hard debugging, security and genuinely ambiguous work.

The `intake` pilot implements step 2 for one narrow purpose: deciding whether
a natural-language request is sufficient or needs an Internal Task Brief
before execution. See [`docs/INTAKE.md`](docs/INTAKE.md).


## Primary agents: Build, Plan, AndMar

AndMar AI does not replace OpenCode's built-in agents.

```text
Build  -> plain OpenCode development
Plan   -> analysis/planning with restricted mutation
AndMar -> OpenCode development + AndMar routing, evidence and completion rules
```

The repository ships a model-agnostic `AndMar` primary agent in `assets/agents/andmar.md`. It uses native OpenCode tools for normal development and calls the existing AndMar capabilities only where they add deterministic value. It does not add another agent runtime.

For local development, the same agent is also present under `.opencode/agents/andmar.md`, so this repository can discover it project-locally.


## MVP capabilities

### `system`
Adds lightweight status, a bounded shell timeout and a durable tool-execution journal.

### `routing`
Routes tasks to a model **profile** rather than a concrete model:

- `fast`
- `standard`
- `frontier`

Workflows and skills never need to know vendor/model names. You map profiles to models once in plugin options.

### `delegation`
Creates native OpenCode child sessions with:

- parent/child ownership;
- inherited authority;
- max depth;
- model-profile selection;
- durable worker handles;
- resume instead of rebuilding context;
- bounded result returned to the parent.

### `lifecycle`
Provides deterministic checks for:

- documentation likely affected by changed paths;
- version impact (`none`, `patch`, `minor`, `major`);
- completion evidence bound to the exact current revision.

### `verification`
Records revision-bound verification receipts (`tests`, `lint`, `typecheck`, `build`, `custom`) backed by observed execution evidence.

The capability never executes commands itself: checks run through native OpenCode shell/tools (preserving permissions), AndMar observes each real outcome via the stable `execute.after` hook into `verification-evidence/<executionId>` (metadata only), and approved receipts reference that evidence. `passed: true` alone is never evidence; failed executions can never become passed receipts. Any revision change invalidates earlier receipts.

### `intake`
Request-refinement pilot: deterministic-first classification with one
structured Jev decision (`typesafe/jev-1.13` by default) over six questions
(`task_kind`, `needs_refinement`, `specification_sufficiency`, `risk`,
`external_contract`, `product_decision_missing`). Trivial requests bypass Jev;
missing key, timeout, failure, or invalid payload degrades to an explicit
`fallback` that never blocks. Structured dev trace via `andmar_intake_trace`
(disabled by default). See [`docs/INTAKE.md`](docs/INTAKE.md).

## Architecture in one picture

```text
User / methodology / skill
          |
          v
      OpenCode V2
 sessions | tools | perms | storage | VCS | worktrees
          |
          v
     AndMar AI core
  config | state | contracts
          |
          v
   generated capability manifest
      /       |       |        |         \
 system   routing  delegation lifecycle verification intake
             |          |          |            |          |
         model tier   workers   docs/version/  check    request
                                completion     receipts refinement
                                gates
```

The core does not know ODD, Product Plan, Lane or Herdr. Request-refinement and future skills consume the `intake`/`route` primitives; Jev lives only inside the `intake` capability, never in core.

## Installation for local development

For real-world testing from this checkout:

```bash
npm install
npm run check
npm run install:dev
npm run doctor
opencode service restart
```

`install:dev` uses OpenCode V2's global discovery locations and does **not** rewrite your `opencode.json(c)`:

```text
~/.config/opencode/plugins/andmar-ai -> this checkout
~/.config/opencode/agents/andmar.md
```

`npm run doctor` validates the OpenCode major version, plugin link, installed agent, and exact plugin-API dependency before the test.

Start OpenCode in any project and use **Tab** to select the `AndMar` primary agent. `Build` and `Plan` remain available.

To remove only the development links/files owned by this checkout:

```bash
npm run uninstall:dev
```

If you prefer explicit plugin configuration or need model-profile mappings, see [`examples/opencode.jsonc`](examples/opencode.jsonc). Missing model profiles inherit the parent session model rather than guessing an ID.

## Tools exposed by the MVP

The namespace is `andmar`:

- `andmar_status` — harness/runtime state.
- `andmar_route` — deterministic model-profile decision.
- `andmar_delegate` — bounded child-session work.
- `andmar_resume` — continue a child by handle.
- `andmar_change_impact` — docs/version impact.
- `andmar_completion_gate` — exact-revision completion check.
- `andmar_record_receipt` — store one verification check outcome for an exact revision.
- `andmar_suggest_checks` — suggest verification commands from deterministic project signals.
- `andmar_verify_revision` — check stored receipts against the exact current revision.
- `andmar_intake` — classify one request as sufficient or needing refinement.
- `andmar_intake_trace` — list recent structured intake decisions.

Names are primitives, not methodologies. A future ODD skill can use these without AndMar AI knowing what ODD is.

## Model-routing examples

```text
"Change button text"             -> fast
"Fix known unit test"            -> fast
"Implement bounded CRUD feature" -> standard
"Debug unclear race condition"   -> frontier
"Security-sensitive change"      -> frontier
"Architecture/migration"         -> frontier
```

A task may request a stronger profile. It may **not** request a profile lower than the deterministic minimum.

Escalation is monotonic:

```text
fast -> standard -> frontier
```

There is no automatic downgrade loop.

## Documentation integrity

Documentation mappings are data, not hard-coded `if` statements:

```jsonc
{
  "documentation": {
    "rules": [
      {
        "id": "public-api",
        "code": ["src/api/**"],
        "docs": ["docs/api/**", "README.md"]
      }
    ]
  }
}
```

If `src/api/users.ts` changes without a mapped documentation file changing, the lifecycle capability reports the documentation as potentially stale. The agent still writes the documentation; code only detects the obligation.

## Adding a capability

Create one folder:

```text
src/capabilities/my-capability/index.ts
```

Export a `Capability`, then run:

```bash
npm run generate
```

The manifest is generated automatically. You should not need to edit the core, root plugin, model policy or other capabilities.

See [`docs/EXTENDING.md`](docs/EXTENDING.md).

## Checks

The project includes pure deterministic tests for routing, path mapping, semver impact, exact-revision completion and verification receipts.

```bash
npm run check
```

The repository uses Bun/OpenCode at runtime, but the deterministic core is intentionally plain TypeScript and has no framework dependency.

## Deliberately not in the MVP

- no custom agent runtime;
- no taxonomy of 10–20 agents;
- no complex workflow engine yet;
- no vector memory;
- no Jev free-text generation (intake pilot answers typed questions only);
- no file leases;
- no custom dashboard;
- no autonomous release/publish pipeline;
- no shell shortcut that bypasses OpenCode permissions;
- no Pi/Gentle compatibility layer.

These are omissions by design, not missing TODOs.

## Documentation map

- [`AGENTS.md`](AGENTS.md) — mandatory guidance for coding agents.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system boundaries and data flow.
- [`docs/MVP-SCOPE.md`](docs/MVP-SCOPE.md) — what the current MVP promises and does not promise.
- [`docs/EXTENDING.md`](docs/EXTENDING.md) — how to add capabilities safely.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — architectural decisions and rationale.
- [`docs/INSPIRATIONS.md`](docs/INSPIRATIONS.md) — patterns extracted from reviewed projects.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — evidence-driven expansion path.
- [`docs/OPENCODE-V2.md`](docs/OPENCODE-V2.md) — V2 API assumptions used by this MVP.
- [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) — validated plugin options.
- [`docs/INTAKE.md`](docs/INTAKE.md) — request-refinement pilot, Jev contract, trace.
- [`docs/STATE.md`](docs/STATE.md) — durable operational state contract.
- [`docs/VERIFICATION.md`](docs/VERIFICATION.md) — what the verification capability does, in plain language.
- [`docs/TESTING.md`](docs/TESTING.md) — first real-world test matrix and current limitations.
- [`docs/VERSIONING.md`](docs/VERSIONING.md) — single-source version/changelog policy.

## License

MIT.
