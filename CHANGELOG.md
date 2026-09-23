# Changelog

All notable changes to AndMar AI are recorded here. The package version in `package.json` is the single source of truth for the current version; runtime version code is generated from it.

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
