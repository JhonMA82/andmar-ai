# AndMar-related OpenCode plugins

AndMar AI itself is an OpenCode native plugin. AndMar does not implement a
proprietary plugin framework. OpenCode's native plugin system is the extension
mechanism. Future AndMar-related plugins can be installed and removed
independently, and must not need internal imports from this repository.
This is the canonical consumer contract; it does not introduce a loader, SDK,
registry, manager, UI or new subsystem.

## Ownership and plugin categories

| Responsibility | Owner |
| --- | --- |
| Procedure / knowledge | Native skill |
| Procedure-exclusive deterministic automation | Skill-local script |
| Harness-wide deterministic automation | Root script/shared helper |
| Runtime invariant, hook, gate or state ownership | Capability |
| External service/system adapter | Integration |
| Presentation / UX running in OpenCode | Independently installed OpenCode plugin |
| Cross-cutting primitive needed by multiple runtime owners | Core |

For example, displaying Work Units in a sidebar belongs to a plugin; Git
lifecycle instructions belong to a skill; Ledger serialization belongs to a
shared script; blocking completion without evidence belongs to a capability;
Engram belongs to integration; the model-selection primitive belongs to core.
Ordinary changes extend one of these surfaces without reorganizing the harness.

| Plugin category | Examples | Consumption / authority |
| --- | --- | --- |
| Presentation | TUI, sidebar, Work Ledger dashboard, progress/verification UI, checkpoint indicator | Read-only or read-mostly RPC/events/compact projections; never authority |
| Observability | Tracing, metrics, telemetry, Langfuse-style adapter, dashboard | Public events and bounded metadata; never controls Ledger, Verification, Task Contract or Completion truth |
| Action / UX | Resume button, run verification, open active WU, authorized delivery | Invoke public AndMar/OpenCode tools; capabilities decide whether an action is allowed |

## Communication boundary

The authoritative path is capability → authoritative state → stable public
projection/RPC/events → OpenCode plugin consumer → presentation/UX.

| Consumer intent | Boundary |
| --- | --- |
| Read | RPC / public projection |
| Observe | Public events |
| Act | Public OpenCode / AndMar tools |

A consumer must never import `src/capabilities/lifecycle/work.ts`, import
`Binding`, import core internals, write AndMar `ctx.storage` keys, edit Task
Contract state directly, recreate Verification or Completion Gate semantics,
or parse Ledger Markdown as its private API. Markdown remains portable durable
representation, and the structured interface remains the machine interface.
No consumer maintains a second authoritative copy of the Ledger.

## Existing RPC: `andmar.work`

Method: `get`. Input: `{ "sessionID": "..." }`.

The current valid-work projection has this shape (values are illustrative):

```json
{
  "workId": "modular-refactor",
  "title": "Close the modular refactor",
  "status": "active",
  "activeWorkUnit": "WU-3",
  "completedUnits": 2,
  "totalUnits": 7,
  "currentActivity": "Running shell",
  "expectedFiles": [],
  "touchedFiles": [],
  "drift": [],
  "scopeKnown": false,
  "lastVerification": null,
  "blockedReason": null,
  "checkpointRequired": false,
  "trackingError": null,
  "pending": ["WU-4"],
  "done": ["WU-1", "WU-2"],
  "completionReady": false
}
```

This is a read-only, reconstructible projection, not storage. Do not write it or
turn visual fields into authority. `null` means the session is unbound. Corrupt
bound work instead returns the compact recovery shape:
`{workId,status:"invalid",recoveryRequired:true,diagnostic,completionReady:false}`.
Handle missing/unknown fields and unavailable RPC explicitly; do not interpret
missing data as PASS or completion. `pending` and `done` contain IDs, not unit
bodies/history. Fetch a required WU/REQ/CON/EV through public `work_context`.

## Existing event: `andmar.work` / `changed`

The RPC event payload is:

```json
{
  "sessionID": "...",
  "workId": "...",
  "reason": "work.unit.started"
}
```

Current reasons include `work.started`, `work.activity`, `work.unit.started`,
`work.unit.completed`, `work.drift`, `work.completed`, `work.tracking.failed`,
`checkpoint.required`, `verification.completed`, `work.amended` and `work.resumed`.
Additional reasons are hints, not a new state machine for the UI.

An event means **state may have changed**. Recommended pattern:
event → RPC `get` → render the latest projection. Filter by the active session,
ignore unknown reasons, and coalesce refreshes when useful. An event does not
contain the Ledger and must not authorize an action. Subscribe and perform an
initial read so the display does not depend on receiving a new event.
The bounded semantic observability feed is described in [STATE.md](STATE.md);
it is distinct from this RPC event transport.

## Activity, verification and checkpoint UX

`currentActivity` is ephemeral, bounded UX metadata, not durable work state.
Today lifecycle emits labels such as `Running shell`; richer labels like
`Running tests`, `Building package`, `Verifying WU-3` or `Indexing repository`
are possible only from observed public metadata. It must never contain
chain-of-thought, secrets, prompts, full commands/logs or full tool output.

`lastVerification` is informative. A UI may display PASS, FAIL, MISSING or
STALE only from authoritative public Verification results. It does not produce
those states. The existing work projection contains the latest bounded
Verification metadata, not a complete per-check table; a detailed table needs
appropriate public evidence, not private storage reads or guessed statuses.
Verification capability plus Completion Gate retain authority. A plugin never
marks a task completed by itself.

When `checkpointRequired` is true, show the blocker, open a real interaction and
optionally offer Resume. Resume invokes public `andmar_work_resume` (native tool
namespace `andmar.work_resume`), after a valid new user response. Do not clear
checkpoint fields, edit the binding, remove WORK.md metadata or manufacture a
user decision. Read/status refreshes and the pre-checkpoint user message are
not consent. A button cannot substitute the required temporal evidence.

## Recommended independent package layout

This is a reference for a future real consumer, not an obligatory framework
or a directory tree to create inside AndMar:

```text
andmar-<plugin-name>/
├── src/
│   ├── index.ts
│   ├── opencode/
│   │   └── client.ts
│   ├── andmar/
│   │   ├── rpc.ts
│   │   ├── events.ts
│   │   └── actions.ts
│   └── presentation/
│       └── ...
├── tests/
├── package.json
└── README.md
```

`index.ts` owns native OpenCode plugin setup/disposal. `opencode/` handles
OpenCode APIs. `andmar/` adapts only public RPC/events/tools. `presentation/`
owns rendering. Do not copy harness policy or import its internals. Use the
installed OpenCode's actual API; this document does not invent a client SDK.

## Future TUI / sidebar example

An independently installed plugin could render the following information:

| Area | Example display |
| --- | --- |
| Work / WU | modular-refactor / WU-3, 2 of 7 completed |
| Current | Running tests |
| Files | 4 touched, 1 drift |
| Verification | tests PASS, typecheck PASS, when public check results establish them |
| Checkpoint | none |
| Completion | not ready |

At startup subscribe to `andmar.work/changed`, call `andmar.work/get`, and render.
On events, refresh and render. When the user invokes an allowed action, call the
public tool; the capability decides, then event/projection updates drive the UI.
Render state is a disposable cache. No sidebar or TUI is implemented here.

## Permissions and lateral failure

Consumers inherit OpenCode's permission model; integration grants no additional
authority. Delivery must pass through `andmar_delivery`. Consumers never create
receipts manually, directly satisfy requirements, close Task Contract, finalize
Ledger before Completion Gate, or resolve a checkpoint without a valid response.
The UI requests; capabilities decide. Running verification means native execution
followed by public receipt/Verification tools, preserving observed execution and
exact working-state revision binding.

If presentation, dashboard or telemetry fails, AndMar continues. Missing RPC
should display unavailable. RPC events are best-effort; consumers must dispose
subscriptions and tolerate reconnect/re-read. No presentation or observability
plugin becomes a health gate or a mandatory dependency of the harness.

## Future contract evolution

No `contractVersion` is added speculatively. When the first external consumer
exists, add an explicit presentation `contractVersion` if needed (for example
`{ "contractVersion": 1, ... }`). Adding fields is normally compatible and
consumers ignore unknown fields. Removing/renaming fields or changing semantics
requires a contract-version bump. Presentation contract version is distinct from
capability version and package SemVer; do not introduce artificial compatibility
machinery in advance.

## Machine-enforced repository boundaries

`check-architecture.mjs` rejects consumer imports into core/capability internals
in paths named `plugin`, `plugins`, `presentation` or `consumers`, including
relative paths and re-exports. External packages need equivalent consumer tests;
this repository cannot scan code that is not present. The checker also protects
core/integration/capability isolation, canonical agent/native skill sources,
functional legacy exclusion and exact generated output. It is a structural
check, not a proof of arbitrary semantic purity or runtime network isolation.
