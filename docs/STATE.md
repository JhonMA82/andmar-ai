# Durable State

AndMar AI uses OpenCode V2 plugin storage for operational facts. This state is deliberately small and JSON-serializable. It is durable execution state, not semantic memory, history, or context.

## Key families and owners

| Keys | Owner | Readers | Lifecycle / cleanup |
|---|---|---|---|
| `runtime/last-start` | `system` | diagnostics | overwritten on every plugin setup |
| `workers/<parent>/<child>` | `delegation` | parent session (own children only) | `running` → `idle`/`failed`; no auto-prune yet |
| `worker-by-session/<child>` | `delegation` | `delegation` (depth calculation) | written alongside `workers/`; no auto-prune yet |
| `journal/<sessionID>/<callID>` | `system` | diagnostics | one entry per observed tool call; unbounded, no pruning yet |
| `verification-evidence/<executionId>` | `verification` | `verification`, `lifecycle` (read-only gate scan) | bound to one revision on first receipt use; unbounded, no pruning yet |
| `verification/<revision>/<check>` | `verification` | `verification`, `lifecycle` (read-only gate scan) | a new revision starts with no receipts; old receipts are never reused; unbounded, no pruning yet |
| `intake-trace/<timestamp>-<rand>` | `intake` | `andmar_intake_trace` queries | max 20 entries, oldest pruned first |

### `runtime/last-start`

Last harness startup metadata (`at`, OpenCode version, project id, harness
version). Written by `src/index.ts` on every setup.

### `workers/<parentSessionID>/<childSessionID>`

Ownership record used by the parent to inspect/resume its direct child.

### `worker-by-session/<childSessionID>`

Reverse lookup used to calculate nested delegation depth.

### `journal/<sessionID>/<callID>`

One lightweight observation per tool call keyed by the stable OpenCode `execute.after` `event.id`. This is diagnostic state, not conversation memory.

### `verification-evidence/<executionId>`

One minimal execution-evidence record per observed non-AndMar tool call (`executionId` as internal call id, tool name, `completed`/`error` status, session, command plus normalized form when the input carries one, timestamp and optional `outputDigest` sha256). The `executionId` segment is `encodeURIComponent`-encoded. Evidence is bound to one working-state revision on first successful `andmar_record_receipt` use and can never satisfy a different revision. Only metadata is stored; full inputs/outputs are never stored, full outputs stay truncated on the receipt itself when the agent supplies them. Old evidence without a command can never satisfy new command-bound receipts (fail closed).

### `verification/<revision>/<check>`

One receipt per verification check (`tests`, `lint`, `typecheck`, `build`, `custom`) for an exact revision. The revision segment is `encodeURIComponent`-encoded so revisions containing `/` cannot collide. A new revision starts with no receipts; old receipts are never reused. Approved receipts carry the internally resolved `executionId`, the recorded `command` and the `sessionID` that produced them.

### `intake-trace/<timestamp>-<rand>`

One structured intake decision for development tuning (max 20 entries, oldest
pruned first). Stores `timestamp`, `sessionID`, `requestHash` (sha256),
`requestLength`, `jevModel`, `jevCalled`, `jevAvailable`, `source`, `reason`,
`latencyMs`, typed `answers`, and `decision.refine`. Full `request` text only
when `ANDMAR_INTAKE_TRACE_CONTENT=1`. Never stores `OPENROUTER_API_KEY`.

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

## Durable vs temporal

- **Durable:** every key family above survives OpenCode restarts via plugin
  storage. Capped only for `intake-trace/` (20 entries).
- **Temporal:** hook disposers and in-flight tool executions live only in the
  setup closure; a restart drops them. There is deliberately no project-level
  active-task record yet (see [TESTING.md](TESTING.md)): after a restart,
  `andmar_resume` still enforces parent-session ownership and a new parent
  cannot take over old children.

## State rules

- A capability owns the keys it writes; another capability may read foreign
  keys only through documented helpers and must never write them.
- Do not store full transcripts; OpenCode owns session history.
- Do not store semantic project memory here.
- Do not store secrets unless OpenCode's storage contract explicitly makes that appropriate and a feature requires it.
- Do not store full tool inputs/outputs; digests and truncation only.
- New persistent shapes should include an obvious migration strategy before changing existing keys.
- Do not introduce a migration framework until the project has real persisted-state migrations to manage.
