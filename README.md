# AndMar AI

**A deterministic-first harness for OpenCode V2.**

AndMar AI is a thin harness that sits on top of OpenCode V2 and adds only the
guarantees that are not wise to leave to an agent's memory or discipline. It is
not an agent runtime, not a general agent framework, not a replacement for
OpenCode, not a port of Gentle-AI, not a workflow engine and not a memory
platform.

The name is a compound of **Andrea + Mario**; it is deliberately broader than
"AndMar Harness", because the harness is the first product.

> Baseline: **v0.15.2** — the planned core evolution (Intake → Work Ledger →
> work-unit lifecycle → checkpoints → Completion → development metrics →
> Delivery) is **complete**. Further additions need measured friction, not a new
> phase.

## The problem it solves

OpenCode already executes well. What repeatedly breaks is consistency between
the code that changed and everything that should have changed with it:

- code ends up correct while the repository is left inconsistent;
- documentation that belonged to the change is forgotten;
- version and changelog obligations are reported, then dropped;
- verification is claimed for work done before the last edit;
- the user's real requirements disappear during execution;
- completion is claimed from a model opinion instead of current evidence;
- delegation loses ownership or quietly raises authority.

AndMar makes those specific failures structurally hard instead of merely
discouraged. Everything else stays with OpenCode.

## Philosophy

```text
deterministic first
OpenCode first
minimal core
capabilities only for runtime guarantees
skills for knowledge/procedures
scripts for deterministic specialized automation
measured friction before features
progressive disclosure
freeze when the objective is satisfied
```

Concretely, decisions are made in this order:

1. **Deterministic code** — schemas, metadata, Git/VCS state, hashes, events
   and explicit rules.
2. **Small semantic decision model** — Jev, only where a rule cannot decide
   cleanly. The `intake` pilot is the one implemented slice.
3. **Frontier model** — reasoning, design, hard debugging, security and
   genuinely ambiguous work.

## What AndMar does not do

- It does not replace OpenCode's sessions, tools, permissions, storage, VCS,
  worktrees, model catalog or skill discovery.
- It does not implement general semantic memory or a vector store; that is
  the optional external [Engram](docs/ENGRAM.md) integration, never an AndMar
  capability.
- It does not implement an agent swarm or an agent taxonomy.
- It does not embed methodologies such as ODD; those are consumers of
  primitives, never runtime infrastructure.
- It does not know concrete technology stacks.
- It does not create a capability when a skill plus a script can solve the
  problem correctly.
- It does not aim at feature parity with Gentle or any other harness.

These are omissions by design, not missing TODOs. The full list of deferred
items lives in [docs/SCOPE.md](docs/SCOPE.md).

## Short flow of a task

```text
request
  ↓
intake            (direct | enrich | structure)
  ↓
Work Ledger       (when the work is worth carrying across sessions)
  ↓
execute with OpenCode
  ↓
verify exact revision
  ↓
docs / version obligations
  ↓
completion        (only when the repository is consistent; no second LLM
  ↓                 judges completion)
  ↓
delivery          (only when explicitly requested, one named operation)
```

The step-by-step version, including which steps are conditional, is
[docs/OVERVIEW.md](docs/OVERVIEW.md) §3.

## Quick start

Local development install from this checkout:

```bash
bun install
bun run check
bun run install:dev
bun run doctor
opencode service restart
```

`install:dev` uses OpenCode V2's global discovery locations and does **not**
rewrite your `opencode.json(c)`:

```text
~/.config/opencode/plugins/andmar-ai -> this checkout
~/.config/opencode/agents/andmar.md
```

`bun run doctor` validates the OpenCode major version, plugin link, installed
agent and the pinned plugin-API dependency before the test.

Start OpenCode in any project and use **Tab** to select the `AndMar` primary
agent. `Build` and `Plan` remain available and unchanged. To remove only the
development links owned by this checkout:

```bash
bun run uninstall:dev
```

For explicit plugin configuration or model-profile mappings, see
[`examples/opencode.jsonc`](examples/opencode.jsonc). Missing profiles inherit
the parent session model rather than guessing an ID.

Full real-world test flow: [docs/TESTING.md](docs/TESTING.md).
All options and environment variables: [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Primary agents: Build, Plan, AndMar

AndMar AI does not replace OpenCode's built-in agents.

```text
Build  -> plain OpenCode development
Plan   -> analysis/planning with restricted mutation
AndMar -> OpenCode development + AndMar routing, evidence and completion rules
```

The repository ships a model-agnostic `AndMar` primary agent in
`assets/agents/andmar.md` (also discoverable project-locally under
`.opencode/agents/andmar.md`). It uses native OpenCode tools for normal
development and calls AndMar primitives only where they add deterministic
value.

## Tools

Namespace `andmar`, registered by 9 capabilities (17 tools). The generated,
authoritative id/version/tool inventory is
[docs/CAPABILITIES.md](docs/CAPABILITIES.md); it is intentionally not
duplicated here so this README cannot drift from it. Per-capability behavior
is [docs/ANDMAR-AI-CAPABILITIES.md](docs/ANDMAR-AI-CAPABILITIES.md).

Names are primitives, not methodologies: a future ODD skill can use them
without AndMar knowing what ODD is. Development metrics are documented in
[docs/DEVELOPMENT-METRICS.md](docs/DEVELOPMENT-METRICS.md) and final delivery
coordination in [docs/DELIVERY.md](docs/DELIVERY.md).

## Model routing in one example

```text
"Change button text"             -> fast
"Fix known unit test"            -> fast
"Implement bounded CRUD feature" -> standard
"Debug unclear race condition"   -> frontier
"Security-sensitive change"      -> frontier
"Architecture/migration"         -> frontier
```

Work is routed to a **profile** (`fast`, `standard`, `frontier`), never to a
concrete model ID; profiles map to models once in configuration. A task may
request a stronger profile, never a weaker one than the deterministic minimum,
and escalation is monotonic with no downgrade loop. Structured examples live in
[`examples/task-routing.md`](examples/task-routing.md).

## Checks

```bash
bun run check
```

Runs manifest generation, the architecture check, typecheck and the pure
deterministic test suite (routing, intake, Work Ledger lifecycle and
checkpoints, verification receipts, exact-revision completion, delegation,
delivery, development metrics, Engram integration). The deterministic core is
plain TypeScript with no framework dependency.

## Next reading

Start here:

1. [`docs/OVERVIEW.md`](docs/OVERVIEW.md) — the problem, the components, the
   real flow of a task, and how skills and capabilities relate.
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — boundaries, ownership and
   data flow.
3. [`docs/CAPABILITIES.md`](docs/CAPABILITIES.md) — generated capability and
   tool inventory.

Then by topic:

- **Extend:** [`docs/CAPABILITY-CONTRACT.md`](docs/CAPABILITY-CONTRACT.md),
  [`docs/EXTENDING.md`](docs/EXTENDING.md)
- **Configure:** [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)
- **State:** [`docs/STATE.md`](docs/STATE.md)
- **Verification:** [`docs/VERIFICATION.md`](docs/VERIFICATION.md)
- **Intake / Jev:** [`docs/INTAKE.md`](docs/INTAKE.md)
- **Testing:** [`docs/TESTING.md`](docs/TESTING.md)
- **Versioning:** [`docs/VERSIONING.md`](docs/VERSIONING.md)
- **Scope and roadmap:** [`docs/SCOPE.md`](docs/SCOPE.md),
  [`docs/ROADMAP.md`](docs/ROADMAP.md)
- **Rationale and history:** [`docs/DECISIONS.md`](docs/DECISIONS.md),
  [`docs/INSPIRATIONS.md`](docs/INSPIRATIONS.md)
- **OpenCode V2 API assumptions:** [`docs/OPENCODE-V2.md`](docs/OPENCODE-V2.md)
- **Optional Engram memory:** [`docs/ENGRAM.md`](docs/ENGRAM.md)
- **Rules for coding agents:** [`AGENTS.md`](AGENTS.md)

## Optional Engram memory

AndMar can use [Engram](https://github.com/Gentleman-Programming/engram) as advisory persistent memory without adding a memory capability to the core. Native Engram MCP tools remain owned by Engram; AndMar adds only status, bounded-use policy and metadata-only metrics.

```sh
npm run engram:setup
# optional stable project identity
engram init <canonical-project-name>
```

Memory never replaces `.andmar/work`, Task Contract state, or Verification evidence, and an Engram failure never blocks work. See [`docs/ENGRAM.md`](docs/ENGRAM.md).



## License

MIT.
