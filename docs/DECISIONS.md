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

**Decision:** `andmar_completion_gate` enforces, in fixed order: exact-revision verification, Task Contract requirements (no `pending`, no `blocked`, every `satisfied` requirement evidenced and revision-current), required independent review, then docs/version obligations. Without a contract the gate keeps its legacy behavior so trivial tasks stay proportional.

**Why:** Tests prove only what they cover. Completion must be backed by evidence for both technical correctness and fulfillment of the explicit user requirements.

**Consequence:** `evaluateCompletionV2` composes the gates; the negative smoke (green tests, pending README requirement → denied) is a first-class test.

---

## D-018 — Fresh independent review, max two rounds

**Decision:** Non-trivial code-changing work requires one independent review in a new child session per round (`frontier` profile, prompt-constrained read-only, compact packet, structured `{verdict, findings}` response). Never resume a review session; after a correction the next round is a new session. Findings block only when linked to a requirement/constraint/desired outcome/missing evidence. Invalid reviewer output is reported and consumes no round. Two rejects block the task — no judge-of-judge.

**Why:** The implementer's claims are not evidence, and reusing a review session anchors the second judgment. Two rounds bound cost and loops.

**Consequence:** Reviews live under `task-contract-review/<sessionID>/<round>`; review sessions are not worker records so `andmar_resume` denies them. Verified against the installed `@opencode/plugin@2.0.4`: no technical read-only session primitive exists, so read-only is prompt-enforced and documented as a limitation (see `OPENCODE-V2.md`).

---

## D-019 — No automatic compaction projection or harness self-tuning

**Decision:** After compaction the agent pulls continuity via `andmar_task_contract status` (compact brief, no transcript). The harness does not hijack the session `compaction` hook result, builds no general memory, and never mutates its own policy/prompts/routing from observability or eval results — it only proposes through evidence → human analysis → approval → implementation.

**Why:** Overwriting the compaction summary would destroy context the model still needs; memory machinery would violate state/context/memory separation; autonomous self-modification has no demonstrated safe trigger.

**Consequence:** Continuity is pull-based and documented in the `AndMar` agent policy; `andmar.contract`/`andmar.review` observability stays metadata-only and fail-open.

## D-020 — Behavioral completion policy is runtime-derived

**Decision:** Task kind is stored in the Task Contract and passed explicitly to
the completion boundary. Contract/review requirements are derived in runtime;
the model cannot disable them with optional `requireContract`,
`requireReview`, or `reviewRequired` flags. Review outcome is derived from
structured blocking findings, revision-sensitive evidence must be revision
bound, and a contract can close as completed only after an exact-revision
completion seal bound to the exact Task Contract state evaluated by the gate.

**Why:** Real-world use showed that prompt-level instructions are not strong
enough for the properties the harness exists to guarantee. A model omission
must produce a denied completion rather than silently falling back to legacy
behavior.

**Consequence:** Trivial task kinds retain the proportional escape hatch.
Non-trivial work fails closed when the Task Contract/review boundary is
missing.

---

## D-021 — Completed-task operational continuations use a proportional fast-path

**Decision:** A new request after a `completed` Task Contract that only operates on the already-approved result (version/changelog metadata, commit, tag, push, publish) runs as `continuation.fastPath=true` with `taskKind=internal`: no new/reopened contract, no `andmar_request_review`, no `andmar_completion_gate` replay. Obvious wording fast-paths deterministically with no Jev; ambiguous wording uses the same single Jev call plus three conditional questions. Fallback never fast-paths. `andmar_request_review` refuses completed contracts.

**Why:** Repeating contract → verification → review → gate ceremony for pure release/VCS operations wastes frontier review and risks re-litigating approved work, while any new code/product requirement must keep full guarantees.

**Consequence:** Intake owns continuation detection; the agent executes only requested operational mutations with proportional checks and leaves the fast-path on any behavior change. No `release` capability yet.

## D-022 — Independent review audits evidence; it does not duplicate verification

**Decision:** Independent final review is a semantic/evidence audit, not a second verification phase. Verification remains responsible for executing relevant checks and recording exact-revision receipts. The reviewer inspects the diff, relevant implementation/tests, requirements, constraints and evidence sufficiency. It must not rerun broad test/typecheck/build/lint/install/repository-wide verification already represented by current-revision evidence. A reviewer may run only bounded targeted spot-checks when a concrete uncertainty cannot be resolved by inspection/search. Missing, stale or insufficient evidence is returned as a structured `target=missing-evidence` finding rather than recreated by the reviewer.

**Why:** Real use on small repositories showed reviewers spending roughly the entire child-session budget repeating verification that AndMar had already completed, causing `session.wait` timeouts without finding implementation defects. The same behavior would scale poorly on large repositories and duplicates responsibilities already owned by Verification.

**Consequence:** `andmar_request_review` remains independent and fresh-session-based, but its packet explicitly treats exact-revision verification as existing execution evidence and asks the reviewer to judge its sufficiency. The 10-minute child-session safety ceiling is not increased. A timeout stores nothing, consumes no review round, emits `andmar.review action=timeout`, and may be retried at most once by policy without rerunning verification.


## D-023 — Review depth is routed deterministically; Jev may only escalate

**Decision:** Final review uses three categorical modes: `none`, `audit`, and `deep`. Deterministic policy sets the minimum: trivial/non-code work may use `none`; security, migration and architecture use `deep`; ordinary code-changing work uses `audit`. Jev is called only for the ordinary `audit` gray zone, receives semantic facts rather than internal receipt identifiers, and may only escalate to `deep`. Jev unavailability falls back to the deterministic minimum.

**Why:** Repeated production-like trials showed the prior reviewer spending its child-session window rediscovering evidence, including treating opaque receipt keys as filesystem names and launching whole-disk searches. Task kind alone was also too coarse: a localized bugfix and a cross-cutting bugfix should not receive identical review depth.

**Consequence:** Review routing is cheap and deterministic first, semantic classification is delegated to Jev only where useful, and the frontier reviewer receives a bounded role. When supported by OpenCode V2, the review child is physically restricted to read/glob/grep operations, so prompt drift cannot turn Review back into Verification.

## D-024 — Review timeout is availability, not a delegation failure

**Decision:** Independent Review has its own bounded session runner instead of
sharing `runChildTask` with delegation. `audit` gets a 90-second wall-clock
budget and `deep` gets 180 seconds. Deadline expiry returns structured
`reviewStatus=unavailable` with stage/elapsed metadata, stores no review round,
and is never retried automatically.

For current-revision `audit`, the completion gate may degrade to deterministic
evidence only when exact-revision verification and the Task Contract requirement
gate are both green and there is no current-revision blocking reject. `deep`
unavailability remains fail-closed. The availability marker is bound to the
contract state token, so steering/evidence mutations cannot reuse a stale
timeout fallback.

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
