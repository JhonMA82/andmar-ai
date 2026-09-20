# Durable State

AndMar AI uses OpenCode V2 plugin storage for operational facts. This state is deliberately small and JSON-serializable.

## Key families

### `runtime/last-start`

Last harness startup metadata.

### `workers/<parentSessionID>/<childSessionID>`

Ownership record used by the parent to inspect/resume its direct child.

### `worker-by-session/<childSessionID>`

Reverse lookup used to calculate nested delegation depth.

### `journal/<sessionID>/<callID>`

One lightweight observation per tool call when the OpenCode hook exposes a stable call ID. This is diagnostic state, not conversation memory.

### `verification/<revision>/<check>`

One receipt per verification check (`tests`, `lint`, `typecheck`, `build`, `custom`) for an exact revision. The revision segment is `encodeURIComponent`-encoded so revisions containing `/` cannot collide. A new revision starts with no receipts; old receipts are never reused.

## Worker record

```ts
{
  sessionID: string
  parentSessionID: string
  profile: "fast" | "standard" | "frontier"
  depth: number
  status: "running" | "idle" | "failed" | "cancelled"
  createdAt: number
  updatedAt: number
}
```

## State rules

- Do not store full transcripts; OpenCode owns session history.
- Do not store semantic project memory here.
- Do not store secrets unless OpenCode's storage contract explicitly makes that appropriate and a feature requires it.
- New persistent shapes should include an obvious migration strategy before changing existing keys.
- Do not introduce a migration framework until the project has real persisted-state migrations to manage.
