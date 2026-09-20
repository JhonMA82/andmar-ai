# Task routing examples

These are examples of structured signals, not prompts that must be copied verbatim.

## Small button copy change

```json
{
  "kind": "trivial-ui",
  "scopeFiles": 1,
  "risk": "low",
  "uncertainty": "low",
  "reasoning": "low"
}
```

Expected minimum: `fast`.

## Ordinary bounded feature

```json
{
  "kind": "feature",
  "scopeFiles": 5,
  "risk": "medium",
  "uncertainty": "low",
  "reasoning": "medium"
}
```

Expected minimum: `standard`.

## Security-sensitive change

```json
{
  "kind": "security",
  "scopeFiles": 1,
  "risk": "high"
}
```

Expected minimum: `frontier`, despite the small file count.
