# Architectural Decisions

This is a compact decision log, not a process-heavy ADR system. Add an entry
only for decisions that future maintainers/agents are likely to reconsider.

**Scope:** this document records *why* — the rationale behind invariants and
limits that are still in force. The current rules themselves live elsewhere:
system explanation in [OVERVIEW.md](OVERVIEW.md), boundaries in
[ARCHITECTURE.md](ARCHITECTURE.md), capability rules in
[CAPABILITY-CONTRACT.md](CAPABILITY-CONTRACT.md). Where an entry and the
implementation disagree, the implementation wins and this log is corrected.

Superseded decisions are deleted, not archived: the evolution history already
lives in Git and in [CHANGELOG.md](../CHANGELOG.md). No `ARCHIVE.md` or similar
dumping ground exists.

## D-001 — OpenCode V2 is the only runtime

**Decision:** AndMar AI supports OpenCode V2 only.

**Why:** A compatibility abstraction for Pi, Gentle-AI or OpenCode V1 would hide native capabilities and increase maintenance without serving the intended product.

**Consequence:** OpenCode-native sessions, permissions, storage, tools, VCS and worktrees are allowed directly in capabilities. The child-session domain is read exactly as OpenCode V2 exposes it (`prompt` → `wait` → `context`); no host-shape tolerance exists.

---

## D-002 — Capability-oriented, not agent-oriented

**Decision:** The harness is composed from capabilities rather than a predefined tree of specialist agents.

**Why:** Agent taxonomies are policy. Delegation, state, verification and routing are reusable primitives.

**Consequence:** One `AndMar` primary agent drives the capabilities; there are no per-domain specialist agents.

---

## D-003 — Generated manifest instead of runtime discovery

**Decision:** Capability registration is generated from `src/capabilities/*/index.ts`.

**Why:** It avoids a handwritten registry without introducing runtime filesystem scanning or bundler-specific magic.

**Consequence:** New capability = folder + `bun run generate`.

---

## D-004 — Model profiles, not model IDs in workflows

**Decision:** Internal APIs use `fast | standard | frontier`.

**Why:** Models change faster than workflows/methodologies. Concrete model IDs should be replaceable in one configuration location.

**Consequence:** A workflow never hard-codes `gpt-*`, `claude-*`, etc.

---

## D-005 — Deterministic routing first

**Decision:** Routing uses structured task signals and explicit rules.

**Why:** Using a frontier model to decide whether a frontier model is needed is wasteful; a semantic classifier is not justified until ambiguous routing becomes a measured problem.

**Consequence:** The only semantic decision in the harness is the narrow `intake` pilot (D-013). Broader semantic uses wait for measured friction.

---

## D-006 — Operational state is not memory

**Decision:** Worker handles, journal data, contracts and verification facts use OpenCode plugin storage. Historical memory is a separate, optional lateral integration (D-030), never execution state.

**Why:** Execution continuity should not depend on semantic memory/retrieval, and a memory subsystem inside the harness would blur the state/context/memory boundary.

**Consequence:** `ctx.storage` holds durable operational facts only; it is never semantic memory, history or context.

---

## D-007 — Worker report does not complete work

**Decision:** Completion requires external evidence and exact-revision matching.

**Why:** Agent self-reports are not reliable enough to serve as a completion invariant.

**Consequence:** A code change invalidates prior evidence.

---

## D-008 — Documentation obligations are mapping-driven

**Decision:** Projects configure `code patterns -> docs patterns`.

**Why:** Documentation relevance is project-specific and should not become a growing set of core path conditionals.

**Consequence:** The harness flags likely staleness but does not generate documentation blindly.

---

## D-009 — Versioning is detection before automation

**Decision:** AndMar identifies likely SemVer impact but does not mutate versions or publish.

**Why:** The existing friction is inconsistency/forgetting. Detection and completion gating solve that first without building a release platform.

---

## D-010 — Isolation/observability remain replaceable

**Decision:** No Lane or Herdr dependency in core.

**Why:** OpenCode already exposes worktrees/sessions/events. Alternative worktree strategies and UI should be adapters.

---

## D-011 — Verification records receipts, never executes checks

**Decision:** The verification capability stores revision-bound check outcomes but does not run shell commands itself. Checks execute through native OpenCode shell/tools; only their results are recorded via `andmar_record_receipt` and evaluated via `andmar_verify_revision`.

**Why:** Executing subprocesses from the harness would bypass OpenCode permission hooks. Recording keeps verification deterministic while preserving the user's permission model.

**Consequence:** A receipt is only as trustworthy as the OpenCode-mediated execution that produced it; the harness guarantees revision binding, not test honesty.

---

## D-012 — Passed receipts require observed execution evidence

**Decision:** `andmar_record_receipt` refuses `passed: true` unless it resolves an execution previously observed by AndMar through the stable `ctx.tool.hook("execute.after", ...)` hook with a successful observed process outcome. The evidence is bound to one working-state revision on first use and can never satisfy another revision; `andmar_verify_revision` reports unbacked approvals as `unverified`. AndMar-owned tool calls are never eligible as check evidence (no self-attestation).

**Why:** Real-world testing showed receipts could be created from a bare agent claim. The smallest deterministic fix is to derive validity from OpenCode-observed execution metadata (id, tool, status, observed exit code/signal/timeout) rather than LLM-declared fields, without running subprocesses from the harness, without storing full outputs, and without a provenance system.

**Consequence:** `execute.after` with its stable `event.id` is the observation contract — `ctx.shell` only offers `create.before` with no result, so there is no better stable hook. A `status: "completed"` tool call is not by itself success: a shell command exiting non-zero still completes as a tool call, so the observed process outcome gates `passed: true`. An unobservable exit code stays unknown rather than becoming a failure.

---

## D-013 — Intake pilot with typed Jev decisions

**Decision:** A small `intake` capability classifies one user request with deterministic checks first and a single OpenRouter Decisions call (`typesafe/jev-1.13` by default, configurable) second. Seven typed questions only; no free-text generation, no SDK dependency (plain `fetch`), explicit `fallback` that never blocks, and a bounded opt-in structured trace under `intake-trace/`.

**Why:** Natural-language requests arrive underspecified; a senior-developer rewrite cannot scale. A typed decision focuses the primary model on an Internal Task Brief only when needed, while `routeSignals` reuse the existing `ChangeKind`/`Risk` taxonomy instead of a second classifier.

**Consequence:** Core stays free of Jev/OpenRouter specifics; `andmar_intake`/`andmar_intake_trace` are the only new tools; trace is off by default and never stores prompts, secrets, or the API key.

---

## D-014 — Internal execution resolution without agent-supplied call IDs

**Decision:** `andmar_record_receipt` accepts no agent-supplied `executionId`. It requires `(revision, check, passed, command)` and resolves a compatible observed execution internally by current `sessionID` plus deterministically normalized command (`trim` + collapse whitespace, no shell parsing). Matching is fail-closed: nonexistent execution, different command, failed-as-passing, other-session execution and revision-bound evidence are all refused without creating a receipt. Evidence stores only minimal metadata (session, internal call id, tool, command + normalized form, status, observed process outcome, timestamp, optional output digest). `andmar_completion_gate` additionally enforces `required verification missing ⇒ gate cannot be formally satisfied`: with non-empty `requiredChecks` (default `tests, typecheck`) the caller can never declare a check green to bypass missing/failed/unverified receipts; `requiredChecks: []` is the explicit proportional opt-out for tasks that genuinely require no checks.

**Why:** Real usage showed the `executionId` belongs to the internal OpenCode hook and is not operative data for the agent, so verified work ended as `missing receipts`. The guarantee stays (receipts derive only from OpenCode-observed executions, never from LLM claims) while the association moves inside Verification.

**Consequence:** Agent flow is `run check via native shell → record with same revision/command → verify_revision → completion_gate`; revision binding and fingerprint semantics are unchanged.

---

## D-015 — No generic Workflow engine

**Decision:** AndMar AI ships no generic workflow capability (no DAG, sequence/parallel/gate DSL, or orchestration board), even though delegation, verification, and the completion gate already compose a linear request flow (see `ARCHITECTURE.md`).

**Why:** The observed friction so far is single-task completion with evidence, which explicit primitive calls plus the completion gate already solve. A workflow engine would add coordination machinery before repeated orchestration pain has been measured in real use.

**Consequence:** Procedures stay in native skills and deterministic scripts; runtime guarantees stay in their owners. D-032 freezes these extension surfaces and excludes a general workflow engine. The `intake` pilot (D-013) is not a precedent for speculative engines.

---

## D-016 — Task Contract as the completion obligation record

**Decision:** Non-trivial work carries one small `TaskContract` per session (`goal`, explicit `requirements` as `REQ-N`, `constraints` as `CON-N`, optional `desiredOutcome`/`verificationSurface`, per-requirement evidence pointers). It is not a workflow, plan, memory, TODO list, or ODD/RDD artifact: no priorities, scores, weights, or trees. Trivial edits skip it. A later user instruction steers the active contract (append-only) unless the user clearly cancels or replaces the goal. Compaction never ends the task: the persisted contract plus `status` projection is the continuity source, never the transcript.

**Why:** Real use showed correct code with green tests still missing the user's actual request. The missing piece is semantic (what was asked), so the primary model extracts obligations while code owns validation, transitions, and gating deterministically.

**Consequence:** `src/core/task-contract.ts` holds the small shared read types/key; `src/capabilities/task-contract/contract.ts` owns transitions/evaluation; `src/capabilities/task-contract/` owns `task-contract/<sessionID>` persistence. No sibling imports; `lifecycle` reads through core key helpers only.

---

## D-017 — Requirement-gated completion

**Decision:** `andmar_completion_gate` enforces, in fixed order: exact-revision stored Verification, Task Contract requirements (no `pending`, no `blocked`, every `satisfied` requirement evidenced and revision-current), then docs/version obligations. Without a contract the gate behaves proportionally, so trivial tasks stay light.

**Why:** Tests prove only what they cover. Completion must be backed by evidence for both technical correctness and fulfillment of the explicit user requirements.

**Consequence:** `evaluateCompletion` composes the gates; the negative smoke (green tests, pending README requirement → denied) is a first-class test.

---

## D-018 — No automatic compaction projection or harness self-tuning

**Decision:** After compaction the agent pulls continuity via `andmar_task_contract status` (compact brief, no transcript). The harness does not hijack the session `compaction` hook result, builds no general memory, and never mutates its own policy/prompts/routing from observability or eval results — it only proposes through evidence → human analysis → approval → implementation.

**Why:** Overwriting the compaction summary would destroy context the model still needs; memory machinery would violate state/context/memory separation; autonomous self-modification has no demonstrated safe trigger.

**Consequence:** Continuity is pull-based and documented in the `AndMar` agent policy; `andmar.contract` observability stays metadata-only and fail-open.

---

## D-019 — Completion policy is runtime-derived

**Decision:** Task kind is stored in the Task Contract and passed explicitly to the completion boundary. Contract requirements are derived at runtime; the model cannot disable them with an optional flag. Revision-sensitive evidence must be revision bound, and only `andmar_completion_gate` may transition a contract to `completed`. `task_contract(op=close)` exists solely to record an explicit cancellation as `blocked`, with a required reason.

**Why:** Real-world use showed that prompt-level instructions are not strong enough for the properties the harness exists to guarantee. A model omission must produce a denied completion rather than a silently degraded one.

**Consequence:** Trivial task kinds retain the proportional escape hatch. Non-trivial work fails closed when the Task Contract boundary is missing. No task kind has a second-judge boundary; all of them rely on exact-revision Verification plus the requirement gate.

---

## D-020 — Completed-task operational continuations use a proportional fast-path

**Decision:** A new request after a `completed` Task Contract that only operates on the already-approved result (version/changelog metadata, commit, tag, push, publish) runs as `continuation.fastPath=true` with `taskKind=internal`: no new/reopened contract, no `andmar_completion_gate` replay. Obvious wording fast-paths deterministically with no Jev; ambiguous wording uses the same single Jev call plus three conditional questions. Fallback never fast-paths.

**Why:** Repeating contract → verification → gate ceremony for pure release/VCS operations wastes frontier-model budget and risks re-litigating approved work, while any new code/product requirement must keep full guarantees.

**Consequence:** Intake owns continuation detection; the agent executes only requested operational mutations with proportional checks and leaves the fast-path on any behavior change. Every named operation still passes through `andmar_delivery` (D-029). No `release` capability exists.

---

## D-021 — Intake is session-bound; the model never supplies the request text

**Decision:** `andmar_intake` accepts no request argument. On execution it uses the tool-call session id and `ctx.session.context({ sessionID })` to recover the authoritative current user message directly from the OpenCode session: the nearest `SessionMessageInfo` with `type="user"` before the current tool's `messageID`, reading its flattened `text` field verbatim. If that message cannot be recovered, intake fails closed into `raw_request_unavailable` with `needsRefinement=true`, never into a model-supplied replacement.

**Why:** Lossless-brief guards could not work in practice: the primary model was summarizing long specifications *before* invoking intake, so Intake only ever saw the summary. Any tool contract that accepts request text from the model leaves that paraphrase/compression path open, no matter how large the input limit is.

**Consequence:** The public tool schema is `{}` and the agent instructions forbid passing or paraphrasing the request. Long specifications reach Jev and the brief builder verbatim. The single fail-closed case is session recovery itself, which requests refinement instead of guessing.

---

## D-022 — Intake mode separates sufficiency from request shape

**Decision:**
- Requests larger than `MAX_STATE_CHARS` (8,000 chars) are deterministically `structure`, preserving raw source.
- Full-context specifications under 8k may also be classified as `structure` via one typed semantic signal (`request_shape="structured"`).
- Non-trivial fallback when Jev is unavailable is conservatively `enrich` rather than `direct`.
- `direct` requires coherent sufficiency (`needsRefinement=false` and `specificationSufficiency >= 3`), not merely the absence of a refinement flag.
- The raw user request remains authoritative across all modes.

**Why:**
`needsRefinement` alone does not distinguish between a compact complete request, an underspecified request, and a detailed structured specification. Furthermore, fallback unavailability of Jev must not be mistaken for specification sufficiency.

**Consequence:**
Intake can route requests correctly without lossy summarization, without new workflow infrastructure and without another LLM call.

---

## D-023 — Work Ledger starts as repository-native portable state, not a capability

**Decision:**
- Work Ledger files live under `.andmar/work/<work-id>/` as repository-native durable Markdown artifacts.
- Native OpenCode file tools (`read`, `write`, `edit`) manage Ledger files; no capability is created to manage them.
- The existing Task Contract remains the bounded runtime completion projection in `ctx.storage`.
- The Work Ledger serves as the portable, unbounded continuity source across sessions, machines, and agents.
- Promotion of any part of Work Ledger to a runtime capability is deferred until demonstrated synchronization or lifecycle friction justifies it.

**Why:**
- Work artifacts can be committed and shared across machines and branches via Git.
- Avoids duplicating state in `ctx.storage` and avoids bypasses of OpenCode's native permission model.
- Prevents premature infrastructure investments before observing actual agent behavior in real projects.
- Eliminates reliance on hidden, invisible model context across compactions and restarts.

**Consequence:**
- Synchronization between Work Ledger and Task Contract is governed by AndMar agent policy and verification gates.
- The `andmar-ai` repository is the one documented exception: it is self-hosted, so `.andmar/` is in its `.gitignore` and it never versions its own execution state. The general policy for consumer projects is unchanged.

---

## D-024 — Work Ledger metadata does not participate in code revision identity

**Decision:**
- `.andmar/work/**` is designated as operational metadata and is strictly excluded from the working-state revision used to bind code/product verification receipts and evidence.
- The runtime Task Contract expands requirement capacity to 100 (`MAX_REQUIREMENTS = 100`) and enforces a strict 1:1 mapping with Work Ledger obligations, eliminating requirement grouping.
- A deterministic structural validator (`scripts/validate-work-ledger.mjs`) is introduced to verify Work Ledger schemas, IDs, active unit limits, and references without semantic interference.
- Work Ledger continues to operate without a new runtime capability or plugin storage namespace.

**Why:**
- Modifying operational metadata (such as recording evidence pointers or updating work unit status in the Ledger) previously altered the dirty working tree fingerprint, creating self-invalidating verification cycles.
- Requirement grouping weakened runtime gates by leaving atomic user obligations un-evidenced at the contract level.
- Prompt-only compliance caused structural drift; deterministic validation provides fast, verifiable feedback.

**Consequence:**
- Code and product verification receipts remain stable across Ledger bookkeeping updates.
- Tasks up to 100 requirements benefit from atomic, uncompressed contract verification.
- Work Ledger structural integrity is validated deterministically before completion without runtime bloat.

---

## D-025 — Work Unit lifecycle is a deterministic repository helper, not a runtime capability

**Decision:**
- Work Unit state transitions in `WORK.md` are performed by `scripts/work-ledger-lifecycle.mjs`.
- The supported lifecycle is intentionally small: `pending -> active`, `active -> done`, `active -> blocked`, `blocked -> active`, and explicit `done -> active` reopening.
- Completing a Work Unit requires already-declared portable evidence (`EV-N`); the helper refuses unknown evidence and rolls back any mutation that fails structural validation.
- The helper may atomically activate the next pending Work Unit, but it does not execute implementation work, verification commands, Task Contract operations, Git commits, or completion gates.
- Work Ledger remains repository-native portable state; no new AndMar capability, workflow runtime, or `ctx.storage` namespace is introduced.

**Why:**
- Manual marker edits are simple but fragile once resume/recovery depends on exact Work Unit state.
- The demonstrated problem is deterministic state transition integrity, not semantic planning or orchestration.
- A small script solves duplicate-active-unit, stale `Next`, unsupported transitions, missing completion evidence, and explicit reopen semantics without growing the core or introducing a workflow engine.

**Consequence:**
- Agents retain freedom inside each Work Unit while AndMar makes progress transitions reproducible and auditable.
- Work Unit completion and recovery cost become reliable repository facts rather than prompt-only conventions.
- Future automatic checkpoint commits can consume these lifecycle events without changing the Work Ledger state model.

---

## D-026 — Work Unit checkpoints are a two-phase Git gate, not a Git capability

**Decision:**
- `scripts/work-unit-checkpoint.mjs` exposes only `status`, `prepare`, and `record`.
- `prepare` is read-only and requires a done/evidenced Work Unit, no Git conflicts, and an exact 64-character verified working-state revision matching current product state.
- OpenCode remains responsible for native staging and commit execution.
- The commit carries deterministic `Work-ID`, `Work-Unit`, and `Verified-Revision` trailers.
- `record` accepts only the current `HEAD`, validates the trailers and product paths, and writes `Checkpoint: <sha>` to `WORK.md`.
- `delivery.workUnitCommits` defaults to `manual`; `auto` is explicit authorization only for local Work Unit checkpoints. Remote/release operations remain separate.
- Reopening a Work Unit clears its current evidence and checkpoint pointers.
- No extra gate is added per Work Unit checkpoint; integrated final verification and the completion gate remain authoritative.

**Why:**
- A verified coherent Work Unit is a useful recovery boundary, but building Git execution into AndMar would duplicate OpenCode, expand permissions, and create a Delivery subsystem prematurely.
- Binding the commit to the verified dirty-working-state revision prevents a later or different diff from being presented as the verified checkpoint.
- Deterministic trailers make the commit self-describing even though the SHA can only be written to `WORK.md` after Git creates the commit.
- Explicit `manual | auto` policy avoids surprising local commits while allowing projects that want checkpoint automation to opt in.

**Consequence:**
- Recovery can use small Git commits aligned to Work Units without turning AndMar into a VCS orchestrator.
- A checkpoint cannot silently combine multiple Work Unit identities in the Ledger; duplicate SHA references are structurally rejected.
- Push/PR/merge/tag/publish/release behavior is unchanged and still requires separate authorization.

---

## D-027 — Completion is one boundary, and the gate closes the contract

**Decision:**
- `andmar_completion_gate` keeps its public tool name but is owned by the `task-contract` capability, which owns the Task Contract state it may close.
- The tool accepts only `currentRevision`, `taskKind`, `docsStatus`, `versionStatus` and proportional `requiredChecks`. There is no caller-declared evidence object, no `testsPassed` boolean, and no manual completed-close: verification success is derived from stored AndMar evidence only.
- A successful non-trivial completion gate closes the Task Contract in the same serialized operation and returns `contractClosed:true`. That is the only transition to `completed`.
- Ledger-backed work first uses deterministic lifecycle `status` (`completionReady:true`) and, after the gate succeeds, lifecycle `finalize --revision <accepted revision>` seals the portable Ledger with final revision/timestamp. No new completion capability or Work Ledger runtime is introduced.

**Why:**
- A previous sequence repeated facts already present in receipts and then required a second tool call to close the same Task Contract, which re-derived what receipts and the requirement gate had already determined.
- Letting `lifecycle` close the contract would violate capability state ownership. Moving only the completion boundary to `task-contract` preserves isolation while leaving documentation/version impact in `lifecycle`.
- Work Ledger already contains durable unit/evidence state; `completionReady` plus a deterministic finalization command is enough to make portable completion explicit without adding another gate.

**Consequence:**
- Normal completion becomes `ledger ready -> reconcile/evidence -> integrated verification -> completion_gate (also closes contract) -> ledger finalize`.
- Missing/failed/unverified receipts still fail closed, and the caller cannot substitute a claim for them.
- Completed Task Contracts continue to drive the existing operational-continuation fast path (D-019).

---

## D-028 — Development metrics reuse semantic events and remain diagnostic

**Decision:** Development metrics are implemented as one isolated `development-metrics` capability exposing `andmar_report`. It subscribes to the existing metadata-only `SemanticObservability` bus and persists one bounded aggregate at `development-metrics/v1/aggregate`. It does not create a dashboard, SQLite database, project-local metrics file, workflow phase, or completion gate.

Recovery/rework metrics are derived read-only from the known portable Work Ledger path `.andmar/work/*/WORK.md`. The scan is bounded to 100 ledgers and never expands into a repository-wide filesystem scan. Work Unit reopen history preserves the previous checkpoint SHA when one existed before the active pointer is cleared, allowing recovery protection to be measured without another source of truth.

**Why:** The harness needs evidence that its capabilities help more than they obstruct, but a telemetry subsystem would violate the thin-harness goal. Existing semantic events already cover runtime decisions, and Work Ledger already owns durable work-unit history.

**Consequence:** `andmar_report` can show intervention, friction, useful-intervention, rework, and checkpoint-coverage rates without storing user content. Unknown facts such as false-block ground truth, rejected duplicate-work attempts, or independent work lost are reported as unmeasured rather than inferred. Metrics never decide task completion.

---

## D-029 — Delivery gates authority/readiness; OpenCode owns execution

**Decision:** One stateless `delivery` capability exposes `andmar_delivery(operation)`. It reads the latest raw user request from the current session and checks the current Task Contract status. The caller cannot submit an authorization boolean. Authorization is operation-specific for `commit`, `push`, `pull-request`, `merge`, `tag`, `version`, `publish`, and `release`; explicit negation denies. Active/blocked Task Contracts deny delivery, completed contracts are ready, and contract-less explicit operational/trivial continuations may proceed only with a native repository-state check.

**Why:** Delivery needs a hard authority boundary, but implementing Git/provider execution would duplicate OpenCode and turn the harness into a workflow/release system. Raw-user intent already exists in session context and is the strongest available source for named-operation authorization.

**Consequence:** `andmar_delivery` never executes VCS/provider actions and owns no durable state. Authorization does not expand from one operation to another. Work Unit checkpoint commits remain governed by `delivery.workUnitCommits`. New core behavior now requires separate evidence and an architectural decision.

---

## D-030 — Engram is an optional lateral integration, not a capability

**Decision:** Integrate Engram under `src/integrations/engram/` without adding a capability, `andmar_mem_*` wrappers, a second memory store, or a completion dependency. Engram owns its MCP tools, storage, lifecycle, diagnostics, setup and sync. AndMar performs cheap discovery, exposes status, injects only AndMar-specific authority/bounded-use policy, and observes metadata-only call volume.

The authoritative order is current explicit user instruction, current repository facts plus portable Work Ledger/Task Contract obligations, exact current Verification, Engram historical context, then model memory. Engram failure is always non-blocking. Current-project retrieval is preferred; cross-project retrieval requires explicit or concrete justification.

**Why:** OpenCode V2 already consumes Engram MCP instructions and native `mem_*` tools successfully. Re-wrapping them would duplicate an existing subsystem and blur the completed core boundary. Work Ledger already owns current portable work state, so memory should retain durable historical knowledge rather than runtime task state.

**Consequence:** The core inventory remains unchanged. Engram can be installed/removed independently and its absence changes nothing about completion or delivery. `andmar_status` reports its integration state, and development metrics can detect excessive or failing retrieval without storing query/result content. Deep health and maintenance stay delegated to `engram doctor`, `engram test`, sync, conflict and project-maintenance CLI commands.

---

## D-031 — Adopt deterministic plan-review patterns without its Plan or Review

**Decision:** Reuse the existing WU lifecycle and repository Ledger. Adopt successful structured file observations, deduplicated touched paths, derived scope drift, bounded necessary-work amendments, exception-only checkpoints, serialized read-modify-write, and a derived read-only presentation projection. Do not copy a Plan, Plan Contract, reviewer, approval-per-step flow, automatic planning classifier or persistent storage/history architecture.

**Reference:** `smykla-skalski/opencode-plugin-plan-review` at
`afd5c3e4f6d849d4607aa183d377e9853ac4a9e0`: `src/plan.ts`, `src/gate.ts`, `src/store.ts`, `src/server.ts`, `src/rpc.ts`, `src/tui.tsx`, `src/schema.ts`.
The patterns are adapted to current AndMar authority, rather than importing the
plugin or its schemas/dependencies. TUI is deferred until a real OpenCode smoke;
the installed `@opencode/plugin@2.0.4` already exposes tool hooks, VCS status
and JSON Schema RPC definitions. This is type/API validation, not a claim of
live runtime behavior on the reference's required OpenCode >=2.0.19.

**Consequence:** Lifecycle capability version 4 adds three bounded work tools,
no new capability, no storage family and no dependency. Native helper calls
and observations share a file lock and the same glob primitive. Runtime loss
requires rebinding a repository work ID, not reconstructing a Plan from hidden
storage. Task Contract, Verification, Completion, Delivery and Intake retain
their current authorities. Projection and tracking gaps are diagnostic, not
extra completion gates.

## D-032 — Final modular surfaces and progressive Ledger API

**Decision:** Freeze core around actual shared primitives. Keep Task Contract
transitions/completion and impact logic with their owners; keep Jev transport in
an optional integration. Canonical native skills carry procedures; the primary
agent carries policy. No registries/frameworks or future empty subsystems.

**Consequence:** Markdown remains portable work truth but routine machine access
uses one structured facade reused directly by lifecycle. Validate before atomic
publication, replace pending evidence, cache only projections and invalidate by
cheap stamps. Invalid state blocks product mutation/completion while repair stays
possible. Known material checkpoints survive recovery. Exact-revision native
Verification and one Completion Gate remain unchanged. Native acceptance uses
real tools/hooks/storage with a deterministic model driver, not synthetic events.
