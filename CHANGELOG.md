# Changelog

All notable changes to AndMar AI are recorded here. The package version in `package.json` is the single source of truth for the current version; runtime version code is generated from it.

## [Unreleased]

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
