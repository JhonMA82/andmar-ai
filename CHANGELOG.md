# Changelog

All notable changes to AndMar AI are recorded here. The package version in `package.json` is the single source of truth for the current version; runtime version code is generated from it.

## [Unreleased]

### Added

- Lifecycle v4: optional per-WU expected/touched files, native observation,
  derived drift, necessary-work amendments and exception-only blocking.
- Read-only Work Ledger projection and optional native RPC notifications;
  existing Verification events are reused. No TUI, Review or new dependency.

### Fixed

- Checkpoint recovery now accepts both namespaced and bare OpenCode tool names,
  so `work_resume` cannot be blocked by the checkpoint it is responsible for
  clearing. Read-only `search` and the non-product status/intake/routing
  controls remain available while product mutation stays fail-closed.

### Hardened

- Native lifecycle and checkpoint helpers serialize Ledger writes; unknown WU
  states and escaping file scopes are rejected. Existing Ledger formats,
  completion authorities and Intake trivial fast path are preserved.
- CLI and runtime share the existing glob primitive, including zero-segment
  `**/` matching.

## [0.15.2] - 2026-09-30

### Added

- Add opt-in lateral `bench/` task/runner/collector/comparator infrastructure with
  eight pinned fixtures, native OpenCode V2 usage, independent success checks,
  separate reported/estimated cost, historical cohorts and deterministic tests.
- Document reference-source decisions, measurement gaps and safe retention debt.
  No runtime capability, routing, completion or development-report behavior changes.

## [0.15.1] - 2026-09-28

### Changed

- AndMar completion is now determined only by explicit Task Contract obligations, deterministic exact-revision Verification, and docs/version obligations. No second LLM judges completion.
- `evaluateCompletionV2` takes `(currentRevision, evidence, verification, requiredChecks, contractGate)`; the review-gate parameter is gone.
- `contractMetrics`, `summarizeContract` and `formatContractBrief` now take only the contract. `ContractMetrics` reports requirement counts only.
- `andmar_completion_gate` derives and reports verification, requirement and docs/version truth only. Removing Review did not weaken verification: a manual `testsPassed: true` still cannot replace stored exact-revision Verification where verification is required.
- Task Contract creation still requires `taskKind`; it now selects the completion obligations and triviality policy instead of a review policy.
- Capability/tool inventory is now 9 capabilities / 14 tools.
- Agent instructions, README, AGENTS.md and every current-state document describe completion without a Review workflow. Risky work keeps stronger verification as a primary-agent discipline, renamed "adversarial final inspection".

### Removed

- The entire AndMar independent-review subsystem: the `andmar_request_review` tool, reviewer child sessions, review routing (`none | audit | deep`), review rounds, review timeout, review availability state, review gate and review requirement in completion.
- `src/capabilities/task-contract/review-session.ts` and its dedicated test file.
- Review domain types and helpers: `ReviewVerdict`, `ReviewMode`, `ReviewFinding`, `ReviewResult`, `ReviewRecord`, `ReviewAvailabilityRecord`, `ReviewGateResult`, `MAX_REVIEW_ROUNDS`, `REQUIRED_REVIEW_KINDS`, `requiresIndependentReview`, `minimumReviewMode`, `evaluateReviewGate`, `validateReviewResult`, `buildReviewPacket`, `isBlockingFinding`, reviewer permission narrowing and reviewer-output extraction.
- `TaskContract.reviewRequired` and the `reviewRequired must be derived from taskKind` validation, plus `reviewRequired` from creation, events, status output, summaries and briefs.
- The `review` requirement-evidence type; the remaining types are `verification`, `runtime`, `diff`, `user-decision`, `external`.
- `CompletionEvidence.reviewPassed` and the `evidence.reviewPassed === false` completion check.
- The `andmar.review` semantic event type and all its emitters.
- The Development Metrics Review section: `activity.review`, `review.rejections`, `review.timeouts`, `review.invalidOutputs`, `review.unnecessaryRetriesPrevented`, the `andmar.review` event processing, and the review coverage strings.
- The `task-contract-review/<sessionID>/...` and `task-contract-review-availability/<sessionID>` state keys.

### Not changed

- No compatibility layer, stub, flag, adapter or state migration was added. Old stored review entries simply become unused data; nothing reads or writes them.
- The `ChangeKind` value `"review"` is unrelated and remains: it classifies a user-requested review-the-code task.
- Exact-revision Verification, receipts, required checks, stale-revision detection, requirement evidence, Work Ledger, Work Units, checkpoints, `finalize`, and Delegation are unchanged.

### Documentation

- Recorded the removal as `D-036` and marked the superseded review decisions (`D-018`, `D-022`, `D-023`, `D-024`, `D-032`; `D-017`, `D-019`, `D-020`, `D-021`, `D-029`, `D-031` updated) as historical.
- `docs/STATE.md`, `docs/CONFIGURATION.md`, `docs/VERIFICATION.md`, `docs/ARCHITECTURE.md`, `docs/OVERVIEW.md`, `docs/SCOPE.md`, `docs/ROADMAP.md`, `docs/TESTING.md`, `docs/OPENCODE-V2.md`, `docs/WORK-LEDGER.md`, `docs/DEVELOPMENT-METRICS.md` and `docs/ANDMAR-AI-CAPABILITIES.md` describe the current architecture without Review.

## [0.15.0] - 2026-09-25

### Added

- Add optional `src/integrations/engram/` adapter without creating a capability or new AndMar memory tools.
- Detect Engram version plus OpenCode MCP configuration and expose bounded status through `andmar_status`.
- Upgrade integration availability evidence after a real native `engram.mem_*` tool call.
- Add `npm run engram:setup`, delegating configuration to the official `engram setup opencode` path.
- Add a short AndMar-specific memory policy: current-project first, bounded retrieval, cross-project only when justified, durable saves only, memory never used as work state/evidence.
- Extend development metrics with metadata-only Engram call counts/failures/cross-project usage; queries and memory content are never captured.
- Document Engram ownership, failure semantics, project identity, sync, diagnostics, and non-goals.
- Core remains complete: capability/tool inventory stays at 9 capabilities / 15 tools.

### Changed

- Documentation consolidated on the `v0.15.0` baseline: retired `docs/MVP-SCOPE.md` in favor of the current `docs/SCOPE.md`, marked the roadmap core evolution as complete, aligned README/ARCHITECTURE/TESTING/VERSIONING/OVERVIEW with the implemented Delivery, Review and Engram boundaries, and marked superseded decisions (`D-006` superseded in part by `D-035`, `D-021` updated by `D-034`).

## [0.14.0] - 2026-09-25

### Added

- New `delivery` capability and `andmar_delivery` tool: one deterministic boundary for post-completion `commit`, `push`, `pull-request`, `merge`, `tag`, `version`, `publish`, and `release` intent.
- Delivery authorization is read directly from the current raw user message; callers cannot pass an `authorized=true` claim. Authorization is operation-specific and explicit negation fails closed.
- Delivery readiness blocks while a Task Contract is still active/blocked and recognizes completed contracts or explicit operational/trivial continuations with no contract.

### Changed

- Post-completion operational continuations now call `andmar_delivery` before each named delivery action, then use native OpenCode Git/VCS/provider tools only when the gate allows it.
- Intake continuation vocabulary recognizes PR/merge/release operations in addition to version/commit/tag/push/publish.
- Core session utilities now expose one generic latest-user-message extractor reused by Intake and Delivery.

### Core freeze

- The planned Intake -> Work Ledger -> Work-unit lifecycle -> checkpoints -> Completion -> Review -> Development metrics -> Delivery evolution is complete. New functionality should default to skills, scripts, adapters, or isolated capabilities and require demonstrated friction before changing core behavior.

## [0.13.0] - 2026-09-25

### Added

- New `development-metrics` capability and `andmar_report` tool for bounded local measurement of Harness Intervention Rate, Harness Friction Rate, Useful Intervention Rate, Work Unit rework, and checkpoint coverage.
- Metadata-only Intake and runtime-error semantic events, plus consecutive exact-revision verification duplication detection.
- Read-only Work Ledger recovery metrics from `.andmar/work/*/WORK.md`, bounded to 100 ledgers and never expanded into a repository-wide scan.
- Reopen lifecycle history now preserves the previous checkpoint SHA before clearing the active pointer, allowing checkpoint-protected recovery to be measured without a second source of truth.

### Changed

- `SemanticObservability` now supports local subscribers independently of the optional external HTTP sink. External observability can be disabled while local development metrics continue to work.
- `andmar_status` exposes `developmentMetrics.enabled`; the default is `true` and `false` makes local metric aggregation a no-op.
- Development metrics are explicitly diagnostic: they do not add a workflow step, completion threshold, dashboard, SQLite database, or project-local telemetry file. Unknown facts are reported as unmeasured rather than guessed.

## [0.12.0] - 2026-09-25

### Changed

- Review routing is now fully deterministic and no longer calls Jev. Jev remains an Intake-only decision primitive.
- Ordinary `feature`/`bugfix`/`refactor`/`debug` work no longer requires independent review for completion; exact-revision Verification is the primary guarantee. `andmar_request_review` remains available as one bounded advisory `audit` when explicitly useful.
- `security`/`migration`/`architecture` keep fail-closed required `deep` review. A blocking result permits one directed correction on a new revision and one fresh final review; there is no third review loop.
- Review timeout and invalid reviewer output are now terminal for the exact revision + Task Contract state. Repeating `andmar_request_review` against unchanged state is refused deterministically instead of encouraging retry loops.
- New review records carry `contractStateToken`, preventing a review of older obligations from silently satisfying a steered Task Contract while preserving compatibility with legacy records.
- Optional audit state no longer participates in the completion gate, removing the previous audit-timeout degradation branch.

### Removed

- Removed the Review-specific Jev router (`src/capabilities/task-contract/review-jev.ts`) and its `ANDMAR_REVIEW_MODEL` / `ANDMAR_REVIEW_TIMEOUT_MS` configuration path.

## [0.11.0] - 2026-09-25

### Added

- Completion-ready Work Ledger status and deterministic `work-ledger-lifecycle.mjs finalize --revision <revision>` sealing of portable completion metadata.
- Completion-gate regression coverage proving stored verification/review evidence drives the verdict and a successful gate closes the Task Contract in the same operation.

### Changed

- `andmar_completion_gate` keeps its public tool name but moves from `lifecycle` to the `task-contract` capability so completion can close state without violating capability ownership.
- Normal completion no longer repeats caller `testsPassed` / `reviewPassed` claims and no longer requires a second `andmar_task_contract(op=close)` call; verification/review truth is derived from stored evidence.
- `lifecycle` is narrowed to documentation/version impact only; Task Contract now owns the completion boundary and emits `contractClosed` in completion results/observability.
- Verification state consumed by completion is read through a shared read-only core helper; `verification` remains the sole writer of receipt/evidence keys and `task-contract` no longer depends on their storage layout directly.
- Agent and Work Ledger policy now use `completionReady -> completion_gate -> finalize`, while legacy evidence input and explicit completed-close remain compatibility paths.

## [0.10.0] - 2026-09-25

### Added

- Two-phase Work Unit checkpoint helper: `scripts/work-unit-checkpoint.mjs` validates a done/evidenced Work Unit against the exact verified working-state revision, then records the native Git commit SHA after OpenCode creates the commit.
- Deterministic checkpoint commit trailers (`Work-ID`, `Work-Unit`, `Verified-Revision`) and current-HEAD/product-path validation.
- Explicit local checkpoint policy `delivery.workUnitCommits = manual | auto`, defaulting to `manual` and exposed by `andmar_status`.
- Real Git regression coverage for checkpoint readiness, recording, trailer guards, metadata-only skips, reopen invalidation, and global-install consumer execution.

### Changed

- Work Ledger validation now checks checkpoint shape, forbids checkpoint SHAs on non-done Work Units, and rejects one checkpoint SHA being assigned to multiple Work Units.
- Reopening a completed Work Unit now clears both its current Evidence and Checkpoint pointers.
- Agent policy now treats a verified Work Unit checkpoint as a recovery boundary without adding per-checkpoint review or changing final integrated verification.

## [0.9.0] - 2026-09-25

### Added

- Deterministic Work Unit lifecycle helper: `scripts/work-ledger-lifecycle.mjs` implements bounded `status`, `activate`, `complete`, `block`, `resume`, and `reopen` transitions over repository Work Ledgers without introducing a workflow capability or new runtime state.
- Evidence-gated Work Unit completion: `complete` requires declared `EV-N` evidence, refuses unknown evidence, atomically promotes the next pending unit (or explicit `--next`), and rolls back mutations that fail structural validation.
- Explicit recovery semantics: blocked units require a reason, resume requires a resolution reason, reopening done work requires a reason and clears the unit's current evidence pointer so stale proof cannot masquerade as current.
- Real lifecycle regression coverage, including consumer-repository execution through the globally installed AndMar plugin path.

### Changed

- AndMar agent policy now uses deterministic lifecycle commands for Work Unit markers and `Next` transitions instead of hand-editing state during normal execution. Native OpenCode edits remain authoritative for Ledger source, requirements, evidence content, steering, and material Work Unit list changes.
- Work Ledger documentation and architecture now define lifecycle transitions as a small deterministic repository helper, not a workflow runtime or capability (D-029).

## [0.8.4] - 2026-09-25

### Fixed

- Materialized revision helper: implemented and verified `scripts/working-state-revision.mjs` (previously referenced in documentation), computing stable SHA-256 fingerprints of product state while strictly excluding `.andmar/work/**`.
- Materialized deterministic Work Ledger validator: implemented and verified `scripts/validate-work-ledger.mjs`, ensuring fast structural validation of ledger schemas, unique identifiers, active unit constraints, and referential integrity.
- Real execution test suites: added `tests/working-state-revision.test.ts` (using real temporary Git repositories) and `tests/work-ledger.test.ts` (exercising all validator rules and edge cases).
- Work Ledger requirement ID format: normalized requirement IDs from `REQ-01`/`REQ-02` to canonical `REQ-1`/`REQ-2` in agent policy and added doc regression tests.
- Intake typing: fixed `exactOptionalPropertyTypes` compatibility in `src/capabilities/intake/decide.ts` when evaluating `requestShape`.
- Consumer helper invocation: agent/docs now resolve Work Ledger helpers from the installed AndMar plugin root (`${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/plugins/andmar-ai`) so commands work from arbitrary target repositories instead of assuming a local `scripts/` directory.
- Symlink-safe helper CLIs: both runtime helpers now detect direct execution through the globally installed plugin symlink, matching the actual `install:dev` topology.
- Work Ledger mode validation: validator now accepts only the canonical portable modes `lightweight | structured`; Intake modes `enrich | structure` are no longer accepted as Ledger modes.

## [0.8.3] - 2026-09-25

### Fixed

- Canonical Work Ledger documentation: added `docs/WORK-LEDGER.md` providing the authoritative specification for repository-native operational state, layouts, work unit lifecycle, and boundaries.
- Atomic 1:1 requirement projection: expanded `MAX_REQUIREMENTS` from 20 to 100 in `src/core/task-contract.ts` and eliminated requirement grouping from agent policy, ensuring every user obligation is verified atomically up to 100 requirements.
- Stable working-state revision: designated `.andmar/work/**` as operational metadata and created deterministic fingerprinting script `scripts/working-state-revision.mjs` (excluding `.andmar/work/**`) to prevent self-invalidating verification cycles during ledger updates.
- Deterministic structural validation: added `scripts/validate-work-ledger.mjs` to validate ledger schemas, IDs (`REQ-N`, `CON-N`, `WU-N`, `EV-N`), active unit constraints, Next action pointers, and cross-references without semantic interference.
- Package files: included `scripts/` in `package.json.files` for consumer availability.

## [0.8.2] - 2026-09-25

### Added

- Work Ledger foundation: introduced repository-native durable operational state under `.andmar/work/<work-id>/` as specified in `docs/WORK-LEDGER.md` and architectural decision `D-027`.
- Portable continuity: Work Ledger serves as the durable, Git-portable continuity source across sessions, compactions, machines, and agents, while Task Contract remains the bounded runtime completion projection in `ctx.storage`.
- Work Projection consumption: agent policy consumes `workProjection.mode` from Intake:
  - `none`: no ledger created by default for trivial/direct tasks.
  - `lightweight`: single `.andmar/work/<work-id>/WORK.md` tracking Goal, Constraints, Requirements, Work Units, Evidence pointers, and `Next`.
  - `structured`: full ledger suite containing `SOURCE.md` (lossless obligations, literal secrets redacted), `REQUIREMENTS.md` (stable IDs, subrequirements), `WORK.md` (work units, single active unit `[~]`, `Next`), and `EVIDENCE.md` (verification and smoke pointers).
- Handling > 20 requirements: retains all atomic obligations in `REQUIREMENTS.md` and groups them into up to 20 parent requirements projected to the runtime Task Contract without losing detail.
- Resume and steering policies: progressive context retrieval on resume; Task Contract reconstruction when missing; user steering updates Ledger first before contract steering; churn prevention restricting Ledger updates to significant operational events.
- Architecture and agent invariants: updated `ARCHITECTURE.md`, `OVERVIEW.md`, `STATE.md`, `AGENTS.md`, `assets/agents/andmar.md`, `.opencode/agents/andmar.md`, and added agent test suite invariants.

## [0.8.1] - 2026-09-25

### Fixed

- Fallback semantics: non-trivial short requests under fallback now correctly yield `mode="enrich"` (`needsRefinement=true`, `workProjection.mode="lightweight"`) instead of falsely certifying sufficiency with `mode="direct"`. Trivial requests keep `direct` and long requests keep `structure`.
- Sufficiency enforcement in `deriveIntakeMode`: low specification sufficiency (`specificationSufficiency <= 2`) can never produce `direct` mode; `direct` requires coherent sufficiency (`needsRefinement=false` and `specificationSufficiency >= 3`).
- Request shape classification: added typed Jev question `request_shape` (`compact | underspecified | structured`). Detailed specifications under `MAX_STATE_CHARS` (8,000 chars) are now correctly recognized as `structure` with `preserveSource=true`.
- Documentation hardening: corrected outdated statements asserting that all `needsRefinement=true` requests produce a compact Internal Task Brief. In `structure` mode, the agent creates a Work-Ledger-shaped projection and never compresses or summarizes away requirements. Fixed literal `OpenCode\x27s` bug in agent definitions.
- Decision log: added `D-026` recording rationale for separating sufficiency from request shape.

## [0.8.0] - 2026-09-25

### Added

- Intake modes: `IntakeDecision` now explicitly distinguishes `direct`, `enrich`,
  and `structure` modes (`IntakeMode`).
- Work projection handoff: added `workProjection` (`WorkProjection`) containing
  `mode: "none" | "lightweight" | "structured"` and `preserveSource: boolean`,
  preparing AndMar for a future durable Work Ledger without implementing persistence yet.
- Deterministic mode policy: pure, testable `deriveIntakeMode` policy function.
  Requests longer than `MAX_STATE_CHARS` (8,000 characters) are deterministically
  forced into `structure` with `preserveSource=true`, preventing partial-context
  decisions by Jev from declaring a long request sufficient.
- "No hidden context" invariant added to agent guidance: all assertions during
  enrich or structure must strictly proceed from user request, repository context,
  or explicitly available upstream sources.
- User decision guidelines: 3-step check before asking the user; agent uses
  native OpenCode question tools when asking is necessary.
- Trace schema updated: `intake_trace` records `mode` and `workProjectionMode`
  in bounded history while preserving prompt privacy defaults.

### Changed

- Backwards compatibility: `needsRefinement` and `brief.required` are preserved
  as derived compatibility properties (`direct` -> `needsRefinement: false`,
  `enrich` and `structure` -> `needsRefinement: true`).
- Agent policy updated in `assets/agents/andmar.md` and `.opencode/agents/andmar.md`
  to handle requests according to `mode` (`direct`: execute normally; `enrich`:
  gather repo context into operational intent; `structure`: structure obligations
  into Work-Ledger-shaped projection without lossy summarization).

## [0.7.4] - 2026-09-24

### Fixed

- Session-bound Intake now parses the actual OpenCode V2 `SessionMessageInfo`
  shape. User messages are flattened as `{ id, type: "user", text }`; the
  previous 0.7.3 parser incorrectly expected legacy `{ info, parts }` records
  and therefore returned `raw_request_unavailable`.
- Intake anchors lookup to `ToolContext.messageID`, the current assistant
  message id exposed by OpenCode V2, and falls back to the latest user message
  if that assistant record has not yet been hydrated into session context.
- Regression tests now use the real flattened session-message shape, including
  a >1000-line raw request.

## [0.7.3] - 2026-09-24

### Fixed

- `andmar_intake` is now session-bound: it reads the authoritative current user
  message directly from `ctx.session.context({ sessionID })` instead of
  accepting request text chosen by the model.
- Removed the public `request` argument from `andmar_intake`, eliminating the
  pre-intake paraphrase/compression path that could turn a long specification
  into a short lossy summary before Intake saw it.
- If the raw user message cannot be recovered, Intake fails closed into
  `raw_request_unavailable` with primary-model refinement required.
- Added regression tests proving long raw messages are preserved verbatim and
  the user turn immediately preceding the current assistant tool call is used.

## [0.7.2] - 2026-09-24

### Fixed

- Intake no longer allows a compact Internal Task Brief to replace or narrow
  the original user request. The raw request remains authoritative; explicit
  requirements and constraints must survive projection into the Task Contract,
  and contradictions must be surfaced instead of silently resolved.
- Long requests may exceed Jev's 8,000-character decision-state window without
  being pre-compressed. Intake accepts raw requests up to 100,000 characters
  and forces primary-model refinement whenever Jev could only inspect a
  partial request, even when Jev reports the visible prefix as sufficient.
- Partial-context continuation decisions cannot enter the operational fast
  path; they return to full-request review instead.
- Added regression coverage for lossless brief policy, long-request fallback,
  and Jev partial-context sufficiency.

## [0.7.1] - 2026-09-24

### Fixed

- Final Review no longer uses the generic delegation child runner. A dedicated
  bounded review runner returns a structured `reviewStatus=unavailable`
  instead of surfacing `child session timed out during session.wait`.
- Review budgets are intentionally short: 90 seconds for `audit`, 180 seconds
  for `deep`; timeout consumes no review round and is not automatically retried.
- A current `audit` timeout may degrade to the deterministic evidence gate only
  when exact-revision verification and Task Contract requirements are green.
  `deep` review unavailability remains fail-closed.
- Completion output now reports whether review was approved, degraded, or
  unavailable, including timeout stage and elapsed time.

## [0.7.0] - 2026-09-23

### Added

- Review routing now has deterministic `none | audit | deep` modes. Security, migration and architecture are hard `deep`; ordinary code-changing work starts at `audit`; trivial/non-code work bypasses review.
- Jev complements only ambiguous `audit` routing and may escalate to `deep`; it can never downgrade deterministic policy and its failure falls back to the deterministic minimum.
- Review child sessions receive a strict read/search-only session policy when the OpenCode V2 permission API is available, preventing shell/curl/tests/builds/network/edits and filesystem-wide scans.

### Changed

- Documentation reorganized into a single reading path: `README.md` → `docs/OVERVIEW.md` (new) → `docs/ARCHITECTURE.md`. `README.md` is now the quick entry (problem, philosophy, explicit non-goals, short task flow, quick start, reading map); `docs/OVERVIEW.md` holds the product view, component ownership, the real current flow with its conditional steps, a worked example, and the skill/capability relationship.
- `docs/ARCHITECTURE.md` gained explicit `Core`, `Capabilities`, `Skills`, `Scripts`, capability-vs-skill rule, documentation-ownership and not-duplicating-OpenCode sections; its duplicated state-key and documentation/version detail now links to `docs/STATE.md`, `docs/CONFIGURATION.md` and `docs/VERSIONING.md`.
- Every remaining document declares its scope and links to the canonical source for shared rules (mission/flow → `OVERVIEW`, boundaries → `ARCHITECTURE`, inventory → generated `CAPABILITIES`, contract → `CAPABILITY-CONTRACT`, configuration → `CONFIGURATION`, state → `STATE`), removing duplicated statements that could diverge.

### Fixed

- Reviewer packets no longer expose raw receipt references, execution IDs, state-store keys or opaque hashes that a reviewer could misinterpret as filesystem paths. Verification summaries are sanitized before Review/Jev routing.
- Audit and deep review use bounded mode-specific child deadlines (4m/8m) instead of allowing a small audit to consume the generic 10-minute ceiling.
- Unbalanced code fences in `docs/ARCHITECTURE.md` §1 that broke the architectural diagram, and a duplicated restart/ownership paragraph in `docs/TESTING.md`.

## [0.6.3] - 2026-09-22

### Fixed

- Independent review is now an evidence audit instead of a second verification phase. Review packets explicitly forbid rerunning broad tests, typechecks, builds, lints, installs, dependency restores or repository-wide verification already represented by exact-revision evidence; reviewers use inspection/search first and only bounded targeted spot-checks for concrete uncertainty.
- Missing or insufficient verification is reported as a structured `target=missing-evidence` finding instead of inviting the reviewer to recreate the full verification phase.
- Review child-session timeouts are classified as `andmar.review action=timeout`, return a recoverable result, store no review and consume no round. The existing 10-minute child-session safety ceiling is unchanged.
- AndMar's primary-agent policy now passes a concise exact-revision `verificationSummary` into review and prevents timeout retry loops.

## [0.6.2] - 2026-09-22

### Added

- Completed-task operational continuations use a proportional fast-path (D-021):
  `andmar_intake` detects `continuation.fastPath` via a narrow deterministic
  bypass (obvious version/commit/tag/push/publish wording) or the same single
  Jev call with three conditional questions, returning `taskKind=internal`
  with no new Task Contract, no `andmar_request_review`, and no
  `andmar_completion_gate` replay. Any new code/product requirement leaves
  the fast-path for the normal flow.
- `andmar_request_review` refuses completed contracts so a bad model decision
  cannot re-trigger frontier review on already-approved work.

## [0.6.1] - 2026-09-21

### Changed

- Task Contract creation now requires `taskKind`; independent-review policy is
  derived by runtime and cannot be disabled by a caller flag.
- Completion gate requires `taskKind`; non-trivial tasks without a Task
  Contract are denied deterministically.
- Review findings tied to Task Contract obligations are authoritative over a
  contradictory model verdict. Advisory/taste-only findings do not block.
- `verification`, `runtime`, `diff`, and `review` requirement evidence
  must carry the exact working-state revision.
- Child-session prompt/wait/context now have a real bounded timeout.
- Closing a contract as completed requires an exact-revision success seal
  written by `andmar_completion_gate`, bound to the exact Task Contract
  state that the gate evaluated.

## [0.6.0] - 2026-09-21

### Fixed

- Child-session results: `session.prompt` queues the message and returns
  the inbox record, not the child's answer. `andmar_delegate`,
  `andmar_resume` and `andmar_request_review` now use the real
  `prompt -> wait -> context` contract (`src/core/session.ts`), so the
  parent receives the child's actual final text (and `andmar_request_review`
  can finally parse reviewer verdicts in real sessions). A child that
  finishes without text is reported explicitly instead of silently
  serializing internal records.
- Task Contract concurrent mutations: contract writes are now serialized
  per session (last-write-wins previously could drop evidence when the
  agent issued parallel `record_evidence`/`update` calls).

### Added

- Task Contract behavioral core: new `task-contract` capability with
  `andmar_task_contract` (single tool, ops `create`/`status`/`update`/
  `record_evidence`/`steer`/`close`; deterministic `REQ-N`/`CON-N` ids;
  append-only steering; compact post-compaction brief) and
  `andmar_request_review` (fresh frontier child session per round, compact
  adversarial packet, structured `{verdict, findings}` response, max two
  rounds, invalid output never stored — real smoke hardening: verdict values
  are normalized tolerantly (case/variants) and a reviewer that returns no
  final text is reported without consuming a round). Pure core in
  `src/core/task-contract.ts`; `andmar_completion_gate` now enforces
  verification → contract requirements → independent review → docs/version
  in that order (legacy behavior preserved when no contract exists).
  New content-free observability events `andmar.contract`/`andmar.review`
  plus contract/review metrics on `andmar.completion`.
- Optional fail-open semantic observability sink compatible with
  `opencodev2-observability` `POST /events`, emitting only bounded
  metadata for `andmar.routing`, `andmar.delegation`,
  `andmar.verification` and `andmar.completion`. No prompts, commands,
  code, tool outputs or reasoning are transmitted; delivery failure never
  affects AndMar execution. Verification observability also records rejected
  receipt attempts as bounded categories without commands, revisions or
  rejection text.

## [0.5.0] - 2026-09-21

### Added

- Generated objective capability index `docs/CAPABILITIES.md` (id, version, description, exposed tools derived from `src/capabilities/*/index.ts`); regenerated by `bun run generate`, never edited manually.
- Canonical `docs/CAPABILITY-CONTRACT.md` for adding or changing a capability (isolation, registration, state ownership, tool rules, configuration, model policy, tests, documentation requirements, done criteria).
- Structural documentation-sync validations in `scripts/check-architecture.mjs`: manifest lists exactly the capability directories, every capability has a `### \`<id>\`` section in `docs/ANDMAR-AI-CAPABILITIES.md`, tool names have exactly one owning capability, and the generated index is in sync.
- Per-capability contract coverage in `docs/ANDMAR-AI-CAPABILITIES.md` (purpose, non-goals, primitives, state ownership, configuration, external contracts, failure behavior, security, testing, limitations), including the previously undocumented `intake` capability.
- D-015: no Workflow engine yet, with the explicit trigger for the first minimal slice.

### Fixed

- Verification friction: `andmar_record_receipt` no longer requires an agent-supplied `executionId`/`callID`. `tool.execute.after` remains the authoritative source and stores minimal metadata (session, internal call id, tool, command + normalized form, status, timestamp, optional output digest); receipts resolve the compatible execution internally by current session plus normalized command with fail-closed matching. Rejects nonexistent, different-command, failed-as-passing, other-session and revision-bound evidence without creating receipts.
- Completion-gate invariant: with non-empty `requiredChecks` (default `tests, typecheck`) a manual `testsPassed: true` can no longer formally verify a revision with missing/failed/unverified receipts; `requiredChecks: []` stays as the explicit proportional opt-out.
- Documentation drift: synced the stale project-local `.opencode/agents/andmar.md` copy with `assets/agents/andmar.md`; corrected `MVP-SCOPE.md` (missing verification/intake primitives, contradicted Jev pilot), `ROADMAP.md` (intake pilot now recorded as implemented), `OPENCODE-V2.md` (stale "no verification receipts yet" VCS section), `DECISIONS.md` D-005, and `TESTING.md` (version refs, Jev wording); canonicalized the development flow on `bun install` / `bun run check` to match CI.

## [0.4.0] - 2026-09-21

### Added

- `intake` request-refinement pilot: `andmar_intake` (deterministic-first, one structured Jev Decisions call over six questions, explicit non-blocking `fallback`) and `andmar_intake_trace` (bounded opt-in dev trace, no prompts or secrets by default). Internal Task Brief guidance in the `AndMar` primary agent; `routeSignals` reuse the existing `ChangeKind`/`Risk` taxonomy. See `docs/INTAKE.md`.


## [0.3.1] - 2026-09-22

### Fixed

- Verification receipts no longer trust a bare agent claim: `andmar_record_receipt` refuses `passed: true` without an `executionId` previously observed via the official stable OpenCode `execute.after` hook with `completed` status. Failed executions can never become passed receipts, and evidence bound to one working-state revision can never satisfy another (`unverified` in `andmar_verify_revision`).
- `system` journal keyed by the real stable `event.id` instead of the never-existing `event.callID`.
- Only minimal execution metadata is stored (`verification-evidence/<executionId>`); AndMar still runs no subprocesses, uses native OpenCode shell/tools, and stores no full outputs in evidence. AndMar-owned tool calls are never eligible as check evidence.

### Changed

- `AndMar` primary agent holds the reinforced `migration`/`integration` termination checklist as part of its completion policy: installed API/type shape, current upstream source/documentation, deprecated/transitional API scan, migration notes/changelog when relevant, and real runtime/integration smoke when available — declaring the absence of a real runtime explicitly as a limitation instead of simulating it.
- Docs updated accordingly (`VERIFICATION.md`, `STATE.md`, `OPENCODE-V2.md` hook contract, `ARCHITECTURE.md`, `ANDMAR-AI-CAPABILITIES.md`, `README.md`) plus D-012.

## [0.3.0] - 2026-09-21

### Added

- `AndMar` custom primary agent for OpenCode V2, kept model-agnostic so it inherits the active/default model.
- Safe development installer/uninstaller using OpenCode's global plugin and agent discovery directories without rewriting user config.
- Read-only `npm run doctor` for OpenCode v2, plugin-link, agent-integrity, and API-pin diagnostics before real tests.
- Agent contract tests and `docs/TESTING.md` for real-world Build/Plan/AndMar comparison.
- Minimal GitHub Actions CI running `bun run check`.

### Changed

- Development installs now refuse to overwrite an existing modified global `andmar.md`.
- `@opencode/plugin` is pinned to `2.0.4` for reproducible OpenCode V2 testing; CI typechecks against the installed package instead of the local API shim.
- Real-world completion guidance now requires a working-state fingerprint when the Git tree is dirty and stronger upstream/runtime evidence for migrations and integrations.

## [0.2.0] - 2026-09-20

### Added

- `verification` capability with revision-bound receipts: `andmar_record_receipt` and `andmar_verify_revision`.
- `andmar_suggest_checks`: deterministic toolchain detection (bun, npm, pnpm, yarn, deno, cargo, go, python) from file-listing signals; suggests, never executes.
- `docs/VERIFICATION.md`: human-language guide for the verification capability.
- 13 deterministic tests for receipts and toolchain detection (25 total).

### Changed

- Documented `verification/*` state keys (`docs/STATE.md`) and D-011 (receipts without execution).
- Marked verification receipts as implemented in `docs/ROADMAP.md` and `docs/ANDMAR-AI-CAPABILITIES.md`.

## [0.1.0] - 2026-09-19

### Added

- OpenCode V2 plugin entrypoint and generated capability registry.
- Deterministic `fast` / `standard` / `frontier` model policy.
- Native child-session delegation with depth, ownership, model profile and durable handles.
- Resume primitive for delegated sessions.
- Durable operational state adapter and lightweight execution journal.
- Documentation impact mapping and conservative SemVer impact classification.
- Exact-revision completion gate.
- Architecture checks preventing core-to-capability and sibling-capability coupling.
- Human and agent documentation for safe extension.
