# Capability Contract

Canonical integration contract for adding or changing an AndMar AI capability.
Practical steps live in [EXTENDING.md](EXTENDING.md); per-capability truth lives
in [ANDMAR-AI-CAPABILITIES.md](ANDMAR-AI-CAPABILITIES.md) and the objective
index in [CAPABILITIES.md](CAPABILITIES.md) (generated, do not edit manually).

## 1. Isolation

- A normal capability is one folder: `src/capabilities/<id>/index.ts`.
- A capability must not import a sibling capability (`check-architecture.mjs`
  fails the repository check when it does).
- Capabilities communicate through `src/core/` contracts (config, state,
  model policy, lifecycle helpers), never through direct imports.
- A core change is justified only when at least two capabilities need the same
  stable primitive; see [ARCHITECTURE.md](ARCHITECTURE.md) and
  [DECISIONS.md](DECISIONS.md).

## 2. Registration

Every capability exports the `Capability` shape from `src/core/contracts.ts`:

```ts
const capability: Capability = {
  id: "<id>",          // matches the folder name
  version: 1,          // increment when persisted state shapes change
  description: "...",  // one clear responsibility; reused by the generated index
  async setup(runtime) {
    // register only the OpenCode V2 hooks/tools owned by this capability
    // return cleanup if needed
  },
}
```

Then run:

```bash
bun run generate
```

`src/generated/capabilities.ts` and `docs/CAPABILITIES.md` are regenerated from
`src/capabilities/*/index.ts`. Never edit generated files manually
(`AGENTS.md` rule 10).

## 3. State ownership

- Operational state belongs in `ctx.storage` via the `StateStore` adapter;
  see [STATE.md](STATE.md) for key families, owners, lifecycle and cleanup.
- A capability owns the keys it writes (e.g. `verification/` belongs to
  `verification`, `workers/` to `delegation`, `intake-trace/` to `intake`).
- Another capability may read foreign keys only through documented helpers;
  it must never write them or change their semantics.
- Never store: full transcripts (OpenCode owns session history), semantic
  project memory, secrets, or full tool inputs/outputs.
- New persistent shapes need an obvious migration strategy before changing
  existing keys: increment the capability `version` and add a small
  deterministic migration. No general migration framework until there are at
  least two real migrations.

## 4. Tool registration

- Register tools only through `ctx.tool.transform` inside `setup`, under the
  `andmar` namespace with `codemode: true`.
- One tool has exactly one owning capability. Tool names must be unique across
  capabilities (`check-architecture.mjs` enforces this).
- Tool `execute` functions must not run subprocesses or bypass OpenCode
  permissions: checks and mutations run through native OpenCode shell/tools;
  the capability observes, records, and gates.
- Never escalate authority: a delegated child must never gain permissions the
  parent did not have.

## 5. Configuration

- Shared options live in the `HarnessConfig` contract (`src/core/config.ts`)
  with validation at plugin setup: invalid configuration fails fast instead of
  being silently coerced.
- Capability-local options (such as `intake.model`) stay out of core when they
  would couple core to provider specifics; they must fail open with documented
  defaults and clamps.
- Every option and environment variable must be documented in
  [CONFIGURATION.md](CONFIGURATION.md) with name, default, purpose, scope, and
  security/privacy implications where relevant. Undocumented options are a bug.

## 6. Model policy

- Use `minimumProfile()` and `clampRequestedProfile()` from
  `src/core/model-policy.ts`.
- Request `fast`, `standard` or `frontier` profiles, never concrete model IDs.
  Concrete selection comes only from configuration; missing mappings inherit
  the parent session model.
- A capability may raise the requested profile for safety; it must never lower
  the deterministic minimum.

## 7. Interaction without hidden dependencies

- Coordinate through shared core contracts and state keys, not imports.
- If two capabilities repeatedly need to coordinate, introduce the smallest
  shared core contract rather than a chain of capability imports.
- Methodologies and skills (ODD, Product Plan, request-refiner) are consumers
  of primitives, never runtime infrastructure: core must not know their names.

## 8. Minimum tests

- Policy/decision logic must be covered by deterministic unit tests under
  `tests/` (pure helpers preferred: no OpenCode imports, no network).
- Live or integration behavior (real OpenCode sessions, Jev calls) is verified
  by manual smoke scripts (e.g. `scripts/intake-smoke.mjs`), never in CI.
- Mocked tests prove fallback/parsing logic, never live integration quality:
  do not present mocks as runtime proof (see [TESTING.md](TESTING.md)).

## 9. Documentation requirements

Documentation ownership is defined once in
[ARCHITECTURE.md](ARCHITECTURE.md) §2.3: a capability owns its behavioral
documentation, the generated index owns inventory, and OVERVIEW/ARCHITECTURE
only explain the system. A capability change is incomplete until the matching
documentation is updated:

- canonical section in [ANDMAR-AI-CAPABILITIES.md](ANDMAR-AI-CAPABILITIES.md)
  (the `### \`<id>\`` heading is enforced by `check-architecture.mjs`);
- [STATE.md](STATE.md) when state keys, ownership, or lifecycle changed;
- [CONFIGURATION.md](CONFIGURATION.md) when options or environment changed;
- [ARCHITECTURE.md](ARCHITECTURE.md) when boundaries or data flow changed;
- [DECISIONS.md](DECISIONS.md) when an architectural decision changed;
- `CHANGELOG.md` when the change is user-visible;
- [../README.md](../README.md) only for human-facing behavior (keep it concise).

## 10. Done means verified

Before the capability is considered finished:

1. `bun run generate` regenerated the manifest and the capability index;
2. `bun run check` passes (generate + architecture checks + typecheck + tests);
3. receipts are bound to the exact final working-state revision when code
   changed (see [VERIFICATION.md](VERIFICATION.md) and the `AndMar` agent
   completion policy);
4. documentation impact (`andmar_change_impact`) and version impact are
   resolved, not merely reported;
5. the final diff was reviewed for duplication and contradictions against this
   contract.
