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

## Semantic observability (environment, fail open)

### `ANDMAR_OBSERVABILITY_URL`

- **Default:** `http://localhost:4000`.
- **Purpose:** optional endpoint compatible with
  `opencodev2-observability`'s `POST /events`.
- **Scope:** semantic AndMar events only: routing, delegation, verification
  and completion.
- **Failure behavior:** 1 s timeout, no retries, maximum 8 concurrent sends;
  failures are dropped and never affect AndMar execution.
- **Privacy:** sends structured metadata only. It never sends prompts, task
  text, commands, code, tool outputs, verification output or model reasoning.

### `ANDMAR_OBSERVABILITY_ENABLED`

- **Default:** enabled.
- Set to `0` to disable semantic emission completely.
- Observability is never required for AndMar to work.

```bash
ANDMAR_OBSERVABILITY_URL=http://localhost:4000
ANDMAR_OBSERVABILITY_ENABLED=1
```

## Intake options (capability-local, fail open)

The `intake` capability reads its own keys so `src/core` stays free of
Jev/OpenRouter specifics. These keys are **not** part of the validated
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
