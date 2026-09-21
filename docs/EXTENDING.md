# Extending AndMar AI

## Goal

A normal capability should be added without modifying the core or several unrelated files.

The binding rules live in [CAPABILITY-CONTRACT.md](CAPABILITY-CONTRACT.md).
This guide is the practical walkthrough; the contract wins on any disagreement.

## Minimal process

### 1. Create a folder

```text
src/capabilities/example/index.ts
```

### 2. Export a Capability

```ts
import type { Capability } from "../../core/contracts.ts"

const capability: Capability = {
  id: "example",
  version: 1,
  description: "One clear responsibility.",
  async setup({ ctx, config, state }) {
    // Register only the OpenCode hooks/tools owned by this capability.
  },
}

export default capability
```

### 3. Regenerate the manifest

```bash
bun run generate
```

Do not manually edit `src/generated/capabilities.ts` or the generated
`docs/CAPABILITIES.md` index.

### 4. Add deterministic tests

If the capability contains policy/decision logic, extract that logic into a pure core helper only when it is truly reusable across capabilities. Otherwise keep it local and test it locally.

### 5. Update documentation only where behavior/contracts changed

Do not update every document for every internal refactor. The required
per-change documentation is listed in
[CAPABILITY-CONTRACT.md](CAPABILITY-CONTRACT.md) section 9; at minimum the
canonical `### \`<id>\`` section in
[ANDMAR-AI-CAPABILITIES.md](ANDMAR-AI-CAPABILITIES.md) must exist
(`check-architecture.mjs` enforces it).

## When a core change is acceptable

A core change is justified when at least two capabilities need the same stable primitive and duplication would otherwise create inconsistent policy.

Examples that belong in core:

- model profile type;
- state-store interface;
- revision-bound completion evidence;
- capability contract.

Examples that do not belong in core:

- a security review prompt;
- ODD steps;
- a specific documentation mapping;
- provider-specific model names;
- Herdr layout code.

## Capability dependency policy

Capabilities should not import sibling capabilities.

Bad:

```text
delegation -> import lifecycle/index.ts
```

Good:

```text
delegation -> core contract <- lifecycle
```

If two capabilities repeatedly need to coordinate, introduce the smallest shared core contract rather than creating a chain of capability imports.

## Metadata over conditionals

Prefer configuration/metadata:

```json
{
  "code": ["src/api/**"],
  "docs": ["docs/api/**"]
}
```

over code like:

```ts
if (path.startsWith("src/api")) { ... }
```

when the rule is project-specific rather than a universal invariant.

## LLM decision checklist

Before adding an LLM call ask:

1. Can code know the answer from structured state?
2. Can a schema force the output shape?
3. Can Git/VCS or a hash prove it?
4. Can task metadata decide it?
5. Is the ambiguity frequent/costly enough to justify a semantic classifier?
6. Only then: does it require a frontier model?

The intended future path is:

```text
deterministic -> small semantic classifier -> frontier
```

not:

```text
frontier for everything
```

## New model providers

Do not add provider adapters to AndMar AI. OpenCode owns provider/model catalogs. Configure only `ModelRef` values exposed by OpenCode.

## New workflow methodology

Do not encode methodologies in core. A methodology should call harness primitives.

If execution semantics become repetitive, add one generic workflow capability and keep methodology definitions outside it.

## Backwards compatibility

MVP state keys are treated as an internal contract. If a state shape changes:

- increment the capability version;
- add a small deterministic migration if persisted state would otherwise break;
- do not add a general migration framework until there are at least two real migrations.
