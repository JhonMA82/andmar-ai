# Changelog

All notable changes to AndMar AI are recorded here. The package version in `package.json` is the single source of truth for the current version; runtime version code is generated from it.

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
