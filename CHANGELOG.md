# Changelog

All notable changes to AndMar AI are recorded here. The package version in `package.json` is the single source of truth for the current version; runtime version code is generated from it.

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
