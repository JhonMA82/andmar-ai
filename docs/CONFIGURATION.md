# Configuration

AndMar AI reads configuration from the plugin `options` object supplied by OpenCode V2. Defaults live beside the capability that consumes them indirectly through the stable `HarnessConfig` contract.

Invalid configuration fails at plugin setup instead of being silently coerced.

## Model profiles

```jsonc
{
  "models": {
    "fast": { "providerID": "provider", "id": "fast-model" },
    "standard": { "providerID": "provider", "id": "standard-model" },
    "frontier": { "providerID": "provider", "id": "frontier-model", "variant": "high" }
  }
}
```

All three are optional. Missing mappings inherit the parent session model when delegating.

The harness never guesses provider/model IDs. Use exact identifiers shown by OpenCode's model catalog.

## Delegation

```jsonc
{
  "delegation": {
    "maxDepth": 3,
    "maxResultChars": 4000
  }
}
```

Constraints:

- `maxDepth`: 1–8;
- `maxResultChars`: 500–50,000.

Defaults are intentionally small.

## Shell guard

```jsonc
{
  "shell": {
    "maxTimeoutMs": 120000
  }
}
```

AndMar AI does not execute its own shell subprocesses. It only caps OpenCode's native shell timeout through the V2 hook, preserving OpenCode permissions.

Allowed range: 1,000–900,000 ms.

## Documentation mappings

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

Rule IDs must be unique. `code` and `docs` are non-empty string arrays.

The matcher currently supports:

- `*` — any characters except `/`;
- `**` — any characters including `/`;
- `?` — one non-`/` character.

Keep mappings coarse and meaningful. Do not map every source file to a document unless that relationship is actually maintained.

## Versioning

```jsonc
{
  "versioning": {
    "enabled": true,
    "publicPaths": ["src/**", "packages/**", "apps/**"]
  }
}
```

These paths tell the lifecycle primitive whether a change touches a release-visible surface. They do not publish releases.
