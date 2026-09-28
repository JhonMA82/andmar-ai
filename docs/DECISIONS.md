# Architectural Decisions

This is a compact decision log, not a process-heavy ADR system. Add an entry only for decisions that future maintainers/agents are likely to reconsider.

**Scope:** this document records *why* — rationale and history. The current
rules themselves live elsewhere: system explanation in [OVERVIEW.md](OVERVIEW.md),
boundaries in [ARCHITECTURE.md](ARCHITECTURE.md), capability rules in
[CAPABILITY-CONTRACT.md](CAPABILITY-CONTRACT.md). Entries here are kept because
they still match the code; where an entry and the implementation disagree, the
implementation wins and this log is corrected.

## D-001 — OpenCode V2 is the only runtime

**Decision:** AndMar AI supports OpenCode V2 only.

**Why:** A compatibility abstraction for Pi, Gentle-AI or OpenCode V1 would hide native capabilities and increase maintenance without serving the intended product.

**Consequence:** OpenCode-native sessions, permissions, storage, tools, VCS and worktrees are allowed directly in capabilities.

---

## D-002 — Capability-oriented, not agent-oriented

**Decision:** The harness is composed from capabilities rather than a predefined tree of specialist agents.

**Why:** Agent taxonomies are policy. Delegation, state, verification and routing are reusable primitives.

**Consequence:** The MVP does not ship `frontend-fast`, `backend-deep`, `security-agent`, etc.

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

**Decision:** MVP routing uses structured task signals and explicit rules.

**Why:** Using a frontier model to decide whether a frontier model is needed is wasteful; a semantic classifier is not justified until ambiguous routing becomes a measured problem.

**Consequence:** Jev was an intended extension, not an MVP dependency. The
narrow slice is now implemented as the `intake` pilot (D-013); broader
semantic uses still wait for measured friction.

---

## D-006 — Operational state is not memory

> **Superseded in part by D-035.** The separation itself still holds —
> `ctx.storage` remains durable execution state and is never semantic memory —
> but memory is no longer simply excluded from the project: Engram is an
> optional lateral integration that keeps historical memory outside both
> `ctx.storage` and the capability inventory.

**Decision:** Worker handles, journal data and runtime facts use OpenCode plugin storage.

**Why:** Execution continuity should not depend on semantic memory/retrieval.

**Consequence:** No memory/vector database in MVP.

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

**Decision:** MVP identifies likely SemVer impact but does not mutate versions or publish.

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

**Decision:** Since v0.3.1, `andmar_record_receipt` refuses `passed: true` unless it references an `executionId` previously observed by AndMar through the official stable `ctx.tool.hook("execute.after", ...)` hook with `completed` status. The evidence is bound to one working-state revision on first use and can never satisfy another revision; `andmar_verify_revision` reports unbacked approvals as `unverified`. AndMar-owned tool calls are never eligible as check evidence (no self-attestation).

**Why:** Real-world testing showed receipts could be created from a bare agent claim. The smallest deterministic fix is to derive validity from OpenCode-observed execution metadata (id, tool, status) rather than LLM-declared fields, without running subprocesses from the harness, without storing full outputs, and without a provenance system.

**Consequence:** `execute.after` (with its stable `event.id` field) is confirmed as the observation contract — `ctx.shell` only offers `create.before` with no result, so there is no better stable hook. The `journal/` key bug (`event.callID`, which never existed) is fixed as part of the same change.

---

## D-013 — Intake pilot with typed Jev decisions

**Decision:** Add a small `intake` capability that classifies one user request with deterministic checks first and a single OpenRouter Decisions call (`typesafe/jev-1.13` by default, configurable) second. Six typed questions only (`task_kind` as `choice` over the existing 12 `ChangeKind` values, `needs_refinement`/`external_contract`/`product_decision_missing` as `noul`, `specification_sufficiency`/`risk` as `score`); no free-text generation, no SDK dependency (plain `fetch`), explicit `fallback` that never blocks, and a bounded opt-in structured trace under `intake-trace/`.

**Why:** Natural-language requests arrive underspecified; a senior-developer rewrite cannot scale. A typed decision focuses the primary model on an Internal Task Brief only when needed, while `routeSignals` reuse the existing `ChangeKind`/`Risk` taxonomy instead of a second classifier.

**Consequence:** Core stays free of Jev/OpenRouter specifics; `andmar_intake`/`andmar_intake_trace` are the only new tools; trace is off by default and never stores prompts, secrets, or the API key.

---

## D-014 — Internal execution resolution without agent-supplied call IDs

**Decision:** `andmar_record_receipt` no longer accepts an agent-supplied `executionId`/`callID`. It requires `(revision, check, passed, command)` and resolves a compatible observed execution internally by current `sessionID` plus deterministically normalized command (`trim` + collapse whitespace, no shell parsing). Matching is fail-closed: nonexistent execution, different command, failed-as-passing, other-session execution and revision-bound evidence are all refused without creating a receipt. Evidence stores only minimal metadata (session, internal call id, tool, command + normalized form, status, timestamp, optional output digest); the resolved internal `executionId` stays for audit. `andmar_completion_gate` additionally enforces `required verification missing ⇒ gate cannot be formally satisfied`: with non-empty `requiredChecks` (default `tests, typecheck`) a manual `testsPassed: true` can never bypass missing/failed/unverified receipts; `requiredChecks: []` remains the explicit proportional opt-out for tasks that genuinely require no checks.

**Why:** Real usage showed the `executionId` belongs to the internal OpenCode hook and is not operative data for the agent, so verified work ended as `missing receipts`. The guarantee stays (receipts derive only from OpenCode-observed executions, never from LLM claims) while the association moves inside Verification.

**Consequence:** Agent flow is `run check via native shell → record with same revision/command → verify_revision → completion_gate`; revision binding and fingerprint semantics are unchanged.

---

## D-015 — No Workflow engine yet

**Decision:** AndMar AI ships no generic workflow capability (no DAG, sequence/parallel/gate DSL, or orchestration board), even though delegation, verification, and the completion gate already compose a linear request flow (see `ARCHITECTURE.md` 2.2).

**Why:** The observed friction so far is single-task completion with evidence, which explicit primitive calls plus the completion gate already solve. A workflow engine would add coordination machinery before repeated orchestration pain has been measured in real use (`docs/TESTING.md` restart scenario is the instrument for this).

**Consequence:** Orchestration stays in the `AndMar` agent's completion policy and in methodology consumers. The first workflow slice, if ever triggered, is only `sequence / parallel / gate / repeat(maxRounds)` for the demonstrated problem — never a general DSL upfront. The `intake` pilot (D-013) is not a precedent for building engines without triggers.

---

## D-016 — Task Contract as the completion obligation record

**Decision:** Non-trivial work carries one small `TaskContract` per session (`goal`, explicit `requirements` as `REQ-N`, `constraints` as `CON-N`, optional `desiredOutcome`/`verificationSurface`, per-requirement evidence pointers). It is not a workflow, plan, memory, TODO list, or ODD/RDD artifact: no priorities, scores, weights, or trees. Trivial edits skip it. A later user instruction steers the active contract (append-only) unless the user clearly cancels or replaces the goal. Compaction never ends the task: the persisted contract plus `status` projection is the continuity source, never the transcript.

**Why:** Real use showed correct code with green tests still missing the user's actual request. The missing piece is semantic (what was asked), so the primary model extracts obligations while code owns validation, transitions, and gating deterministically.

**Consequence:** `src/core/task-contract.ts` holds pure types/transitions/evaluation; `src/capabilities/task-contract/` owns `task-contract/<sessionID>` persistence. No sibling imports; `lifecycle` reads through core key helpers only.

---

## D-017 — Requirement-gated completion

**Decision:** `andmar_completion_gate` enforces, in fixed order: exact-revision verification, Task Contract requirements (no `pending`, no `blocked`, every `satisfied` requirement evidenced and revision-current), then docs/version obligations. Without a contract the gate keeps its legacy behavior so trivial tasks stay proportional.

> **Updated by D-036.** The independent-review step in that order no longer
> exists.

**Why:** Tests prove only what they cover. Completion must be backed by evidence for both technical correctness and fulfillment of the explicit user requirements.

**Consequence:** `evaluateCompletionV2` composes the gates; the negative smoke (green tests, pending README requirement → denied) is a first-class test.

---

## D-018 — Fresh independent review, max two rounds

> **Superseded by D-032 and removed by D-036.** This entry is historical: the
> whole independent-review subsystem it describes no longer exists.

**Decision:** Non-trivial code-changing work requires one independent review in a new child session per round (`frontier` profile, prompt-constrained read-only, compact packet, structured `{verdict, findings}` response). Never resume a review session; after a correction the next round is a new session. Findings block only when linked to a requirement/constraint/desired outcome/missing evidence. Invalid reviewer output is reported and consumes no round. Two rejects block the task — no judge-of-judge.

**Why:** The implementer's claims are not evidence, and reusing a review session anchors the second judgment. Two rounds bound cost and loops.

**Consequence:** Reviews live under `task-contract-review/<sessionID>/<round>`; review sessions are not worker records so `andmar_resume` denies them. Verified against the installed `@opencode/plugin@2.0.4`: no technical read-only session primitive exists, so read-only is prompt-enforced and documented as a limitation (see `OPENCODE-V2.md`).

---

## D-019 — No automatic compaction projection or harness self-tuning

**Decision:** After compaction the agent pulls continuity via `andmar_task_contract status` (compact brief, no transcript). The harness does not hijack the session `compaction` hook result, builds no general memory, and never mutates its own policy/prompts/routing from observability or eval results — it only proposes through evidence → human analysis → approval → implementation.

**Why:** Overwriting the compaction summary would destroy context the model still needs; memory machinery would violate state/context/memory separation; autonomous self-modification has no demonstrated safe trigger.

**Consequence:** Continuity is pull-based and documented in the `AndMar` agent policy; `andmar.contract` observability stays metadata-only and fail-open.

## D-020 — Behavioral completion policy is runtime-derived

> **Updated by D-036.** The review requirements, the `requireReview` /
> `reviewRequired` flags and the blocking-finding derivation no longer exist.
> Task kind still selects the contract/completion obligations at runtime.

**Decision:** Task kind is stored in the Task Contract and passed explicitly to
the completion boundary. Contract requirements are derived in runtime;
the model cannot disable them with an optional `requireContract` flag.
Revision-sensitive evidence must be revision bound, and a contract can close
as completed only after an exact-revision completion seal bound to the exact
Task Contract state evaluated by the gate.

**Why:** Real-world use showed that prompt-level instructions are not strong
enough for the properties the harness exists to guarantee. A model omission
must produce a denied completion rather than silently falling back to legacy
behavior.

**Consequence:** Trivial task kinds retain the proportional escape hatch.
Non-trivial work fails closed when the Task Contract boundary is missing.
No task kind has a second-judge boundary; all of them rely on exact-revision
Verification plus the requirement gate.

---

## D-021 — Completed-task operational continuations use a proportional fast-path

> **Updated by D-034.** Post-completion delivery operations now pass through
> `andmar_delivery` authorization/readiness before OpenCode executes the named
> operation natively. There is still no release capability and no release
> engine.

> **Updated by D-036.** The `andmar_request_review` references no longer
> apply; the fast-path itself is unchanged.

**Decision:** A new request after a `completed` Task Contract that only operates on the already-approved result (version/changelog metadata, commit, tag, push, publish) runs as `continuation.fastPath=true` with `taskKind=internal`: no new/reopened contract, no `andmar_completion_gate` replay. Obvious wording fast-paths deterministically with no Jev; ambiguous wording uses the same single Jev call plus three conditional questions. Fallback never fast-paths.

**Why:** Repeating contract → verification → gate ceremony for pure release/VCS operations wastes frontier-model budget and risks re-litigating approved work, while any new code/product requirement must keep full guarantees.

**Consequence:** Intake owns continuation detection; the agent executes only requested operational mutations with proportional checks and leaves the fast-path on any behavior change. No `release` capability yet.

## D-022 — Independent review audits evidence; it does not duplicate verification

> **Superseded by D-036.** Historical only; the auditor described here no longer
> exists.

**Decision:** Independent final review is a semantic/evidence audit, not a second verification phase. Verification remains responsible for executing relevant checks and recording exact-revision receipts. The reviewer inspects the diff, relevant implementation/tests, requirements, constraints and evidence sufficiency. It must not rerun broad test/typecheck/build/lint/install/repository-wide verification already represented by current-revision evidence. A reviewer may run only bounded targeted spot-checks when a concrete uncertainty cannot be resolved by inspection/search. Missing, stale or insufficient evidence is returned as a structured `target=missing-evidence` finding rather than recreated by the reviewer.

**Why:** Real use on small repositories showed reviewers spending roughly the entire child-session budget repeating verification that AndMar had already completed, causing `session.wait` timeouts without finding implementation defects. The same behavior would scale poorly on large repositories and duplicates responsibilities already owned by Verification.

**Consequence:** `andmar_request_review` remains independent and fresh-session-based, but its packet explicitly treats exact-revision verification as existing execution evidence and asks the reviewer to judge its sufficiency. A timeout stores nothing, consumes no review round, emits `andmar.review action=timeout`, and is terminal for the exact revision + Task Contract state. It is not retried unchanged.


## D-023 — Review depth is routed deterministically; Jev may only escalate

> **Superseded by D-032 and removed by D-036.** Historical only.

**Historical decision:** Review originally used three categorical modes with a deterministic floor and a Jev escalation from `audit` to `deep` for ordinary code. That extra semantic router is removed by D-032.

**Why it changed:** Real use showed that Review routing itself did not justify another model call. The useful distinction is categorical and stable: ordinary code can rely on exact-revision Verification, while security/migration/architecture justify mandatory deep semantic review.

**Current consequence:** See D-032. `minimumReviewMode()` is now the complete deterministic routing policy and Review has no Jev dependency.

## D-024 — Review timeout is availability, not a delegation failure

> **Superseded by D-032 and removed by D-036.** Historical only; the bounded
> review runner, its deadlines and the availability marker no longer exist.

**Decision:** Independent Review has its own bounded session runner instead of
sharing `runChildTask` with delegation. `audit` gets a 90-second wall-clock
budget and `deep` gets 180 seconds. Deadline expiry returns structured
`reviewStatus=unavailable` with stage/elapsed metadata, stores no review round,
and is never retried automatically.

Ordinary `audit` is advisory and therefore never participates in the completion
gate. `deep` unavailability remains fail-closed. The terminal attempt marker is
bound to the exact revision and Task Contract state token, so unchanged timeout
or invalid-output attempts cannot trigger retry loops and steering/evidence
mutations cannot reuse a stale attempt state.

**Why:** Review is a bounded semantic/evidence audit, not a worker. Reusing the
generic child-task lifecycle made a stalled `session.wait` look like task
failure and encouraged long retry loops. The narrower policy preserves safety
for high-risk work while preventing ordinary review transport failure from
holding otherwise verified work for several minutes.

**Consequence:** Delegation/resume keep the existing generic child runner and
10-minute safety ceiling unchanged. Review timeout handling is explicit,
observable and proportional without introducing a new workflow engine.

## D-025 — Intake is session-bound; the model never supplies the request text

**Decision:** `andmar_intake` accepts no request argument. On execution it uses
the tool-call session id and `ctx.session.context({ sessionID })` to recover
the authoritative current user message directly from the OpenCode session:
the nearest `SessionMessageInfo` with `type="user"` before the current tool's
`messageID`, reading its flattened `text` field verbatim. If that message
cannot be recovered, intake fails closed into `raw_request_unavailable` with
`needsRefinement=true`, never into a model-supplied replacement.

**Why:** The 0.7.2 lossless-brief guards could not work in practice: the
primary model was summarizing long specifications *before* invoking intake, so
Intake only ever saw the summary. Any tool contract that accepts request text
from the model leaves that paraphrase/compression path open, no matter how
large the input limit is.

**Consequence:** The public tool schema is `{}` and the agent instructions
forbid passing or paraphrasing the request. Long specifications reach Jev and
the brief builder verbatim. The single fail-closed case is session recovery
itself, which requests refinement instead of guessing.

---

## D-026 — Intake mode separates sufficiency from request shape

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

## D-027 — Work Ledger starts as repository-native portable state, not a capability

**Decision:**
- Work Ledger files live under `.andmar/work/<work-id>/` as repository-native durable Markdown artifacts.
- Native OpenCode file tools (`read`, `write`, `edit`) manage Ledger files; no dedicated capability is created in 0.8.2.
- The existing Task Contract remains the bounded runtime completion projection in `ctx.storage`.
- The Work Ledger serves as the portable, unbounded continuity source across sessions, machines, and agents.
- Promotion of any part of Work Ledger to a runtime capability is deferred until demonstrated synchronization or lifecycle friction justifies it.

**Why:**
- Work artifacts can be committed and shared across machines and branches via Git.
- Avoids duplicating state in `ctx.storage` and avoids bypasses of OpenCode's native permission model.
- Prevents premature infrastructure investments before observing actual agent behavior in real projects.
- Eliminates reliance on hidden, invisible model context across compactions and restarts.

**Consequence:**
- Synchronization between Work Ledger and Task Contract is initially governed by AndMar agent policy and verification gates.
- Measured drift and developer friction in 0.8.2 will inform future potential capabilities or work-unit checkpoint commit automation.

---

## D-028 — Work Ledger metadata does not participate in code revision identity

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

## D-029 — Work Unit lifecycle is a deterministic repository helper, not a runtime capability

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

## D-030 — Work Unit checkpoints are a two-phase Git gate, not a Git capability

**Decision:**
- Add `scripts/work-unit-checkpoint.mjs` with only `status`, `prepare`, and `record`.
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


## D-031 — Completion is evidence-derived and Task Contract closes inside the gate

**Decision:**
- `andmar_completion_gate` keeps the same public tool name but is owned by the `task-contract` capability, which owns the Task Contract state it may close.
- Normal callers provide the final `currentRevision`, `taskKind`, `docsStatus`, `versionStatus`, and relevant `requiredChecks`; verification success is derived from stored AndMar evidence instead of a repeated caller boolean.
- A successful non-trivial completion gate closes the Task Contract in the same serialized operation and returns `contractClosed:true`; a second `andmar_task_contract(op=close)` call is no longer part of the normal flow.
- The legacy `CompletionEvidence` object and exact-seal completed-close path remain accepted as compatibility paths, but new agent policy does not depend on them.
- Ledger-backed work first uses deterministic lifecycle `status` (`completionReady:true`) and, after the gate succeeds, lifecycle `finalize --revision <accepted revision>` seals the portable Ledger with final revision/timestamp. No new completion capability or Work Ledger runtime is introduced.

**Why:**
- The old sequence repeated facts already present in receipts (`testsPassed`, `reviewPassed`), then created a completion seal solely so a second tool call could close the same Task Contract.
- Letting `lifecycle` close the contract would violate capability state ownership. Moving only the completion boundary to `task-contract` preserves isolation while leaving documentation/version impact in `lifecycle`.
- Work Ledger already contains durable unit/evidence state; `completionReady` plus a deterministic finalization command is enough to make portable completion explicit without adding another gate.

**Consequence:**
- Normal completion becomes `ledger ready -> reconcile/evidence -> integrated verification -> completion_gate (also closes contract) -> ledger finalize`.
- Missing/failed/unverified receipts still fail closed.
- Completed Task Contracts continue to drive the existing operational-continuation fast path.
- D-020's completion-seal close handshake is superseded for the normal flow; its legacy compatibility guard remains available for older callers.

## D-032 — Review is deterministic, advisory for ordinary work, and required only for high-risk kinds

> **Superseded by D-036.** Historical only. The entire subsystem below was
> removed; nothing in this entry describes current behavior.

**Decision:** Review is reduced to one deterministic policy table:

```text
trivial/docs/internal/review
→ none

feature/bugfix/refactor/debug
→ exact-revision Verification is the primary guarantee
→ review is not required for completion
→ `andmar_request_review`, when explicitly useful, runs one bounded advisory audit

security/migration/architecture
→ deep independent review required for completion
→ one initial review
→ at most one directed correction + new revision + fresh final review
→ no third review loop
```

Review no longer calls Jev. `minimumReviewMode()` is the complete routing policy.
Jev remains in Intake only.

A review attempt that times out or produces invalid output stores a bounded
`task-contract-review-availability/<sessionID>` marker tied to both the exact
revision and `contractStateToken`. A second request against that unchanged
state is refused deterministically. The same no-repeat rule applies when an
actual review record already exists for that exact revision/state. Changing the
implementation revision or Task Contract state creates a new review state; a
required deep review may then use the one remaining corrected-revision round.

New review records include `contractStateToken`, so steering the Task Contract
cannot silently reuse a review of older obligations. Legacy records without the
token remain readable for compatibility.

**Why:** Production-like use showed that ordinary review created the largest
remaining harness friction: duplicated semantic ceremony, child-session
timeouts, invalid-output retry temptation, and a second decision model (Jev)
for a policy that can be expressed categorically. Exact-revision Verification
already provides the deterministic guarantee for normal code changes. The
independent reviewer adds the most value at security, migration, and
architecture boundaries where semantic contract risk is materially higher.

**Consequence:** Normal feature/bugfix/refactor/debug tasks can complete without
opening a reviewer session when their Work Ledger, Task Contract, exact-revision
Verification, and lifecycle obligations are green. Optional audit findings are
advisory and never block completion. Required deep review stays read/search-only,
fail-closed when unavailable, and bounded to one directed correction cycle.
Review has no LLM routing dependency and no unchanged-state retry loop.

## D-033 — Development metrics reuse semantic events and remain diagnostic

**Decision:** Development metrics are implemented as one isolated `development-metrics` capability exposing `andmar_report`. It subscribes to the existing metadata-only `SemanticObservability` bus and persists one bounded aggregate at `development-metrics/v1/aggregate`. It does not create a dashboard, SQLite database, project-local metrics file, workflow phase, or completion gate.

Recovery/rework metrics are derived read-only from the known portable Work Ledger path `.andmar/work/*/WORK.md`. The scan is bounded to 100 ledgers and never expands into a repository-wide filesystem scan. Work Unit reopen history preserves the previous checkpoint SHA when one existed before the active pointer is cleared, allowing recovery protection to be measured without another source of truth.

**Why:** The harness needs evidence that its capabilities help more than they obstruct, but a telemetry subsystem would violate the thin-harness goal. Existing semantic events already cover runtime decisions, and Work Ledger already owns durable work-unit history.

**Consequence:** `andmar_report` can show intervention, friction, useful-intervention, rework, and checkpoint-coverage rates without storing user content. Unknown facts such as false-block ground truth, rejected duplicate-work attempts, or independent work lost are reported as unmeasured rather than inferred. Metrics never decide task completion.

## D-034 — Delivery gates authority/readiness; OpenCode owns execution

**Decision:** Add one stateless `delivery` capability exposing `andmar_delivery(operation)`. It reads the latest raw user request from the current session and checks the current Task Contract status. The caller cannot submit an authorization boolean. Authorization is operation-specific for `commit`, `push`, `pull-request`, `merge`, `tag`, `version`, `publish`, and `release`; explicit negation denies. Active/blocked Task Contracts deny delivery, completed contracts are ready, and contract-less explicit operational/trivial continuations may proceed only with a native repository-state check.

**Why:** Delivery needs a hard authority boundary, but implementing Git/provider execution would duplicate OpenCode and turn the harness into a workflow/release system. Raw-user intent already exists in session context and is the strongest available source for named-operation authorization.

**Consequence:** `andmar_delivery` never executes VCS/provider actions and owns no durable state. Authorization does not expand from one operation to another. Work Unit checkpoint commits remain governed by `delivery.workUnitCommits`. This completes the planned core evolution; new core behavior now requires separate evidence and an architectural decision.


## D-035 — Engram is an optional lateral integration, not a capability

**Decision:** Integrate Engram under `src/integrations/engram/` without adding a capability, `andmar_mem_*` wrappers, a second memory store, or a completion dependency. Engram owns its MCP tools, storage, lifecycle, diagnostics, setup and sync. AndMar performs cheap discovery, exposes status, injects only AndMar-specific authority/bounded-use policy, and observes metadata-only call volume.

The authoritative order is current explicit user instruction, current repository facts plus portable Work Ledger/Task Contract obligations, exact current Verification, Engram historical context, then model memory. Engram failure is always non-blocking. Current-project retrieval is preferred; cross-project retrieval requires explicit or concrete justification.

**Why:** OpenCode V2 already consumes Engram MCP instructions and native `mem_*` tools successfully. Re-wrapping them would duplicate an existing subsystem and blur the completed core boundary. Work Ledger already owns current portable work state, so memory should retain durable historical knowledge rather than runtime task state.

**Consequence:** The core inventory remains unchanged. Engram can be installed/removed independently. `andmar_status` reports its integration state, and development metrics can detect excessive or failing retrieval without storing query/result content. Deep health and maintenance stay delegated to `engram doctor`, `engram test`, sync, conflict and project-maintenance CLI commands.

---

## D-036 — The independent-review subsystem is removed, not replaced

**Decision:** AndMar has no independent-review subsystem. There is no
`andmar_request_review` tool, no reviewer child session, no review routing
table, no review rounds, no review timeout, no review-availability marker, no
review gate, and no review requirement in completion. Completion is decided
only by explicit Task Contract obligations plus deterministic
exact-revision Verification plus docs/version obligations. No second LLM
judges completion.

Concretely, the removal deletes `src/capabilities/task-contract/review-session.ts`
and the whole review domain: `ReviewVerdict`/`ReviewMode`/`ReviewFinding`/
`ReviewResult`/`ReviewRecord`/`ReviewAvailabilityRecord`/`ReviewGateResult`,
`MAX_REVIEW_ROUNDS`, `REQUIRED_REVIEW_KINDS`, `requiresIndependentReview()`,
`minimumReviewMode()`, `evaluateReviewGate()`, `validateReviewResult()`,
`buildReviewPacket()`, `isBlockingFinding()`, `TaskContract.reviewRequired`,
`CompletionEvidence.reviewPassed`, the `review` requirement-evidence type, the
`andmar.review` semantic event, the `task-contract-review*` state keys, and the
Review section of Development Metrics. Contract metrics, summaries and briefs
now take only the contract.

**Why:** The subsystem had converged on a second, weaker verification engine.
Its own recorded rationale (D-022, D-024, D-032) already showed reviewers
spending their budget re-deriving what exact-revision Verification had
deterministically proven, and its fail-closed unavailability path could only
block already-verified work. Once Review was made deterministic it duplicated
the requirement gate; once the requirement gate existed at all, a second LLM
judge added cost, latency, child-session failure modes and a weaker signal than
the receipts it was asked to audit. Deleting it also makes the harness's core
promise legible: one runtime boundary, one deterministic evidence model, one
set of state keys.

**Consequence:** The `task-contract` capability keeps its identity and loses one
tool; its public surface changes, so its capability version increments
(2 → 3). No compatibility layer, stub, flag, adapter, or state migration is
added: `task-contract-review*` entries written by earlier versions simply
become unused data that nothing reads or writes. The `ChangeKind` value
`"review"` is unrelated and stays: it classifies a user-requested
review-the-code task. Delegation, Work Ledger, Work Units, checkpoints,
receipts, revision verification and the completion gate are unchanged; removing
Review does not weaken them, and exact-revision verification still blocks
unverified completion. Risky work keeps stronger verification as a
primary-agent discipline ("adversarial final inspection"), not as another
agent. Reintroducing any second LLM judge requires a new architectural decision
with fresh evidence.
