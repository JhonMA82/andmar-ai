# Durable State

**Scope:** state key families, their owners, readers and lifecycle. The
ownership *rules* are [CAPABILITY-CONTRACT.md](CAPABILITY-CONTRACT.md) §3; the
state-vs-context-vs-memory boundary is [ARCHITECTURE.md](ARCHITECTURE.md) §6.

AndMar AI uses OpenCode V2 plugin storage for operational facts. This state is deliberately small and JSON-serializable. It is durable execution state, not semantic memory, history, or context.

> **Repository vs runtime state:** Work Ledger is repository state under `.andmar/work/<work-id>/`, not `ctx.storage` state. It must not be mirrored as `work-ledger/<sessionID>` in plugin storage. See [WORK-LEDGER.md](WORK-LEDGER.md) and [DECISIONS.md](DECISIONS.md) D-023.

## Key families and owners

| Keys | Owner | Readers | Lifecycle / cleanup |
|---|---|---|---|
| `runtime/last-start` | `system` | diagnostics | overwritten on every plugin setup |
| `integrations/engram/status` | `integrations/engram` | `andmar_status`, integration hook | one bounded advisory snapshot overwritten at startup/observed native Engram calls; never stores memory content |
| `workers/<parent>/<child>` | `delegation` | parent session (own children only) | `running` → `idle`/`failed`; no auto-prune yet |
| `worker-by-session/<child>` | `delegation` | `delegation` (depth calculation) | written alongside `workers/`; no auto-prune yet |
| `journal/<sessionID>/<callID>` | `system` | diagnostics | one entry per observed tool call; unbounded, no pruning yet |
| `verification-evidence/<executionId>` | `verification` | `verification`, `task-contract` (read-only via `core/verification-state`) | bound to one revision on first receipt use; unbounded, no pruning yet |
| `verification/<revision>/<check>` | `verification` | `verification`, `task-contract` (read-only via `core/verification-state`) | a new revision starts with no receipts; old receipts are never reused; unbounded, no pruning yet |
| `intake-trace/<timestamp>-<rand>` | `intake` | `andmar_intake_trace` queries | max 20 entries, oldest pruned first |
| `task-contract/<sessionID>` | `task-contract` | `task-contract` | one active contract per session; `active` → `completed`/`blocked`; unbounded, no pruning yet |
| `development-metrics/v1/aggregate` | `development-metrics` | `andmar_report` | one bounded metadata-only aggregate; overwritten as counters advance; disabled by `developmentMetrics.enabled=false` |
| *(none)* | `delivery` | — | Delivery is stateless; it reads current session user intent + Task Contract readiness and stores no authorization copy |

### `runtime/last-start`

Last harness startup metadata (`at`, OpenCode version, project id, harness
version). Written by `src/index.ts` on every setup.


### `integrations/engram/status`

One bounded snapshot for the optional Engram lateral integration: installed/configured/enabled flags, detected version, effective config source, agent-profile detection, availability basis, and last native Engram tool status/timestamp when observed. It contains no query, prompt, observation, or tool-output content. This state is diagnostic only and can never satisfy Completion or Delivery. Engram itself owns persistent semantic memory.

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

`task-contract` consumes verification truth only through the shared read-only
`src/core/verification-state.ts` contract. That helper owns no state and writes
nothing; it centralizes the verification key shape and exact-revision summary so
completion does not couple itself to verification's internal storage layout.

### `intake-trace/<timestamp>-<rand>`

One structured intake decision for development tuning (max 20 entries, oldest
pruned first). Stores `timestamp`, `sessionID`, `requestHash` (sha256),
`requestLength`, `jevModel`, `jevCalled`, `jevAvailable`, `source`, `reason`,
`latencyMs`, typed `answers`, and `decision.refine`. Full `request` text only
when `ANDMAR_INTAKE_TRACE_CONTENT=1`. Never stores `OPENROUTER_API_KEY`.

### `task-contract/<sessionID>`

The active Task Contract for one parent session: `goal`, optional
`desiredOutcome`/`verificationSurface`, `requirements` (`REQ-N` with
`pending`/`satisfied`/`blocked`/`skipped`, evidence pointers, reasons),
`constraints` (`CON-N`), and `status`
(`active`/`blocked`/`completed`). Steering appends requirements/constraints
with the next deterministic numbers and never removes. Stores no
transcripts, chain-of-thought, prompts, or source code — only obligations
and evidence pointers. `andmar_completion_gate` is the only writer of
`completed`; `op=close` writes `blocked` on an explicit cancellation with a
reason.

### `development-metrics/v1/aggregate`

One bounded local aggregate of semantic-event counters used by `andmar_report`. It contains timestamps and numeric counters only (tasks observed/completed, interventions, useful interventions, friction categories and the last verification identity used solely for consecutive duplicate detection). It never stores prompts, requirement text, code, commands or tool output. Work Ledger rework/checkpoint metrics are read from `.andmar/work/*/WORK.md` at report time and are not mirrored into plugin state.

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
  storage. `intake-trace/` is capped at 20 entries; `development-metrics/v1/aggregate` is a single bounded record rather than an event log.
- **Temporal:** hook disposers and in-flight tool executions live only in the
  setup closure; a restart drops them. There is deliberately no project-level
  active-task record yet (see [TESTING.md](TESTING.md)): after a restart,
  `andmar_resume` still enforces parent-session ownership and a new parent
  cannot take over old children.

## State rules

Ownership, permitted reads, prohibited content and migration expectations are
defined once in [CAPABILITY-CONTRACT.md](CAPABILITY-CONTRACT.md) §3 and are not
restated here. In short: a capability owns the keys it writes, foreign keys are
read-only through documented helpers, and transcripts, semantic memory, secrets
and full tool inputs/outputs never go into these keys.

### Lifecycle Work Ledger projection

`lifecycle` adds no `ctx.storage` keys. A setup-local session-to-work binding,
in-flight call-to-WU attribution, transient dirty-file hashes, activity and a
compact last-observed verification summary are dropped at cleanup/restart.
Checkpoint authorization has no setup-local baseline: `Checkpoint At` and
optional `Checkpoint User` belong only to the blocked WU in `WORK.md`.
Readers never reconstruct or update this boundary from the latest response.
Optional WU file metadata and discovered work are written only to repository
`WORK.md` through the existing lifecycle helper. Its projection is computed
on demand; RPC/event consumers cannot write it back or decide execution.
See [WORK-LEDGER.md](WORK-LEDGER.md) for persistence, restart and coverage rules.

## Retention debt (no runtime change)

The benchmark audit confirms `journal/`, `verification/` and
`verification-evidence/` are unbounded. Intake already retains at most 20 traces;
development metrics are one bounded aggregate. No benchmark cleanup changes
runtime state or deletes evidence.

A future explicit maintenance operation can use maximum age 30 days and maximum
10,000 entries per unbounded family, pruning the oldest eligible entries first
(timestamp then key as deterministic tie-breaker). These are proposed defaults,
not active configuration. Bounds apply only to eligible closed/unreferenced state:
protect every active/blocked Task Contract and worker, all revisions and execution
IDs referenced by requirements, receipts, or portable Work Ledger
evidence/checkpoints. Preserve an entire protected receipt/evidence chain.

Implement a dry-run inventory before deletion, resolving references through the
existing owner contracts and scanning storage with its native pagination. If any
reference cannot be resolved, state inventory is incomplete, a Ledger cannot be
read, or OpenCode can still mutate a protected session, fail closed and retain the
affected records. Never enforce a hard cap by deleting protected evidence; report
remaining over-budget state instead. Coordinating references and active sessions
crosses several state owners, so implementation is deferred rather than forcing
a core migration into the lateral benchmark.

Verification evidence identity: the first observation retains the native ID;
collisions use `observed-<sha256(nativeId)>-<ordinal>` in the same namespace.
Allocation checks durable entries after restart. Metadata writes are serialized
within plugin setup; receipt binding never changes previous execution outcomes.
No counter, duplicate Ledger or new persistent namespace is introduced.

## Structured Ledger projections and recovery

No new ctx.storage key is introduced. Lifecycle's binding retains only workId,
directory, current activity/verification metadata, recovery diagnostic, trusted
checkpoint boundary and a session-local compact projection. Four cheap
inode/size/ctimeNs/mtimeNs stamps invalidate it. Changed state is read as a stable
snapshot and validated; unchanged hooks do not parse full Markdown again.

Portable creation, evidence and transitions use the shared structured helper.
After mutation the response is derived from validated in-memory bytes; future
hooks confirm current state against changed stamps. Recovery preserves native
read/search/question and Ledger-only repair while product mutation/completion
remain refused. Repair cannot silently clear a previously trusted checkpoint.
Restart derives everything durable from the repository, not a Ledger mirror.
