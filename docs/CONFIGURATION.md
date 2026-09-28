# Configuration

AndMar AI reads configuration from the plugin `options` object supplied by OpenCode V2. Shared options live in the `HarnessConfig` contract (`src/core/config.ts`); defaults live beside it.

Invalid shared configuration fails at plugin setup instead of being silently coerced. Capability-local options (intake) fail open with documented defaults and clamps so core stays free of provider specifics.

An annotated example lives in [`examples/opencode.jsonc`](../examples/opencode.jsonc).

## Shared options (`HarnessConfig`, validated)

### `models.fast` / `models.standard` / `models.frontier`

- **Name:** `models.<profile>` where profile is `fast`, `standard` or `frontier`.
- **Type:** `{ providerID: string, id: string, variant?: string }` (`ModelRef`).
- **Default:** all three unset (`{}`).
- **Purpose:** map deterministic profiles to concrete models once, so
  workflows and skills never hard-code vendor/model names.
- **Scope:** used by `andmar_route` output and by `andmar_delegate` model
  selection.
- **Security/privacy:** none beyond OpenCode's own model catalog. Use exact
  identifiers shown by OpenCode's catalog. Missing mappings inherit the parent
  session model; the harness never guesses provider/model IDs.

```jsonc
{
  "models": {
    "fast": { "providerID": "provider", "id": "fast-model" },
    "standard": { "providerID": "provider", "id": "standard-model" },
    "frontier": { "providerID": "provider", "id": "frontier-model", "variant": "high" }
  }
}
```

All three are optional.

### `delegation.maxDepth` / `delegation.maxResultChars`

- **Names:** `delegation.maxDepth` (integer 1–8), `delegation.maxResultChars`
  (integer 500–50,000).
- **Defaults:** `maxDepth: 3`, `maxResultChars: 4000`. Intentionally small.
- **Purpose:** bound nesting depth and the size of results returned to the
  parent session.
- **Scope:** `andmar_delegate` / `andmar_resume` only.
- **Security/privacy:** depth bounding prevents unbounded session fan-out;
  result truncation keeps child transcripts out of the parent context.

```jsonc
{
  "delegation": {
    "maxDepth": 3,
    "maxResultChars": 4000
  }
}
```

### `shell.maxTimeoutMs`

- **Name:** `shell.maxTimeoutMs` (integer 1000–900000 ms).
- **Default:** `120000`.
- **Purpose:** ceiling applied to OpenCode's native shell timeout through the
  `create.before` hook.
- **Scope:** every native shell creation while the plugin is active.
- **Security/privacy:** AndMar AI does not execute its own shell subprocesses;
  it only caps the timeout, preserving OpenCode permissions. The cap can only
  lower timeouts, never raise them.

```jsonc
{
  "shell": {
    "maxTimeoutMs": 120000
  }
}
```

### `documentation.rules`

- **Name:** `documentation.rules` (array of `{ id, code[], docs[] }`;
  ids unique, `code`/`docs` non-empty string arrays).
- **Default:** `[]` (no obligations detected).
- **Purpose:** project-specific `code patterns -> docs patterns` mappings so
  `andmar_change_impact` can flag likely stale documentation.
- **Scope:** `lifecycle` documentation-impact analysis only.
- **Security/privacy:** none; patterns, not content.

```jsonc
{
  "documentation": {
    "rules": [
      {
        "id": "api",
        "code": ["src/api/**"],
        "docs": ["docs/api/**", "README.md"]
      }
    ]
  }
}
```

The matcher supports `*` (any characters except `/`), `**` (any characters
including `/`), and `?` (one non-`/` character). Keep mappings coarse and
meaningful; do not map every source file unless that relationship is actually
maintained.

### `versioning.enabled` / `versioning.publicPaths`

- **Names:** `versioning.enabled` (boolean), `versioning.publicPaths`
  (array of non-empty glob strings).
- **Defaults:** `enabled: true`, `publicPaths: ["src/**", "packages/**", "apps/**"]`.
- **Purpose:** tell the lifecycle primitive whether a change touches a
  release-visible surface for SemVer impact detection.
- **Scope:** `andmar_change_impact` version classification only. Detection
  never mutates versions, tags, or releases.
- **Security/privacy:** none.

```jsonc
{
  "versioning": {
    "enabled": true,
    "publicPaths": ["src/**", "packages/**", "apps/**"]
  }
}
```

### `delivery.workUnitCommits`

- **Name:** `delivery.workUnitCommits` (`"manual" | "auto"`).
- **Default:** `"manual"`.
- **Purpose:** authorize local, recoverable Git checkpoint commits after a Work Unit is done and its exact working-state revision has focused verification.
- **Execution boundary:** AndMar gates readiness; OpenCode executes native Git. No Git capability is introduced.
- **`manual`:** checkpoint preparation is allowed, but AndMar does not create a commit unless the current user request or repository policy explicitly authorizes commits.
- **`auto`:** a successful checkpoint `prepare` authorizes the local Work Unit commit and subsequent SHA recording.
- **Never implied:** push, PR, merge, tag, publish, release, or remote side effects. Those remain separately authorized operations.

```jsonc
{
  "delivery": {
    "workUnitCommits": "auto"
  }
}
```

The active value is exposed by `andmar_status` so the agent does not need hidden configuration context.

### `developmentMetrics.enabled`

- **Name:** `developmentMetrics.enabled` (boolean).
- **Default:** `true`.
- **Purpose:** enable the local bounded aggregate consumed by `andmar_report`.
- **Scope:** development diagnostics only; it never gates completion.
- **Privacy:** numeric/enum metadata only. No prompts, code, commands or tool output are stored.

```jsonc
{
  "developmentMetrics": {
    "enabled": false
  }
}
```

This setting is independent from external semantic observability. Disabling `ANDMAR_OBSERVABILITY_ENABLED` stops HTTP emission but does not disable local metrics; set `developmentMetrics.enabled=false` for a complete local metrics no-op.

## Semantic observability (environment, fail open)

### `ANDMAR_OBSERVABILITY_URL`

- **Default:** `http://localhost:4000`.
- **Purpose:** optional endpoint compatible with
  `opencodev2-observability`'s `POST /events`.
- **Scope:** semantic AndMar events only: intake, routing, delegation, verification,
  completion, contract, delivery and bounded runtime errors.
- **Failure behavior:** 1 s timeout, no retries, maximum 8 concurrent sends;
  failures are dropped and never affect AndMar execution.
- **Privacy:** sends structured metadata only. It never sends prompts, task
  text, commands, code, tool outputs, verification output or model reasoning.

### `ANDMAR_OBSERVABILITY_ENABLED`

- **Default:** enabled.
- Set to `0` to disable external HTTP semantic emission. Local `development-metrics` subscribers remain available unless `developmentMetrics.enabled=false`.
- External observability is never required for AndMar to work.

```bash
ANDMAR_OBSERVABILITY_URL=http://localhost:4000
ANDMAR_OBSERVABILITY_ENABLED=1
```

## Intake options (capability-local, fail open)

The `intake` capability reads its own keys so model/timeout resolution stays
capability-local: `src/capabilities/intake/jev-client.ts` holds only the
Decisions transport (endpoint and payload shape) and no provider policy. These
keys are **not** part of the validated
`HarnessConfig`: unknown or malformed values fall back to defaults instead of
failing plugin setup. See [INTAKE.md](INTAKE.md) for the full pilot contract.

### `intake.model`

- **Name:** `intake.model` (non-empty string) or `ANDMAR_INTAKE_MODEL`.
- **Default:** `typesafe/jev-1.13`.
- **Purpose:** which Jev model answers the six typed intake questions.
- **Scope:** `andmar_intake` only.
- **Precedence:** explicit plugin option wins; otherwise the environment
  variable; otherwise the default.
- **Security/privacy:** a model name, not a secret; configurable without core
  coupling.

### `intake.timeoutMs`

- **Name:** `intake.timeoutMs` (milliseconds) or `ANDMAR_INTAKE_TIMEOUT_MS`.
- **Default:** `8000`. Clamped to 1000–60000 ms.
- **Purpose:** bound the single Jev call; on timeout intake degrades to an
  explicit non-blocking `fallback`.
- **Scope:** `andmar_intake` only.
- **Precedence:** explicit plugin option wins; otherwise the environment
  variable; otherwise the default.
- **Security/privacy:** none.

```jsonc
{
  "intake": {
    "model": "typesafe/jev-1.13",
    "timeoutMs": 8000
  }
}
```

### Trace flags (environment only)

- **Names:** `ANDMAR_INTAKE_TRACE=1` (enable the bounded dev trace),
  `ANDMAR_INTAKE_TRACE_CONTENT=1` (also store full request text; dev only).
- **Defaults:** both disabled.
- **Purpose:** tune intake questions/thresholds from real decisions via
  `andmar_intake_trace` (max 20 entries, plugin storage).
- **Scope:** trace collection only; not readable as configuration by other
  capabilities.
- **Security/privacy:** trace stores the request sha256 hash and length by
  default — never prompts, never `OPENROUTER_API_KEY`. Enabling
  `ANDMAR_INTAKE_TRACE_CONTENT=1` stores raw request text: use only in local
  development, never with secrets in the request.

```bash
OPENROUTER_API_KEY=sk-or-v1-...   # required for live Jev; never stored or logged
ANDMAR_INTAKE_MODEL=typesafe/jev-1.13
ANDMAR_INTAKE_TIMEOUT_MS=8000
ANDMAR_INTAKE_TRACE=1
ANDMAR_INTAKE_TRACE_CONTENT=1
```

## Removed review settings

The independent-review subsystem was removed, so it has **no configuration at
all** — no routing table, no reviewer model, no deadline, no Jev call. There is
nothing to enable and no legacy variable to migrate: `ANDMAR_REVIEW_MODEL` and
`ANDMAR_REVIEW_TIMEOUT_MS` are not read by any current code path. Jev
configuration applies to Intake only. See [DECISIONS.md](DECISIONS.md).


## Engram integration

Engram has no AndMar core configuration block. It is an optional external integration. Configure it with the upstream owner:

```sh
npm run engram:setup
# equivalent ownership boundary:
engram setup opencode
```

Use `engram init <canonical-project-name>` when a repository needs a stable Engram project identity across machines. Avoid a global `ENGRAM_PROJECT` during ordinary multi-project work. Deep diagnostics use `engram doctor --json` and `engram test --quick --json`. See [ENGRAM.md](ENGRAM.md).
