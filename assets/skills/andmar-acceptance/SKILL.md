---
name: andmar-acceptance
description: Check the actual user-visible result against obligations and external contracts. Use for migrations, integrations, architectural changes or claims that unit tests cannot establish.
---

Map each explicit requirement to evidence appropriate to its claim. Verify the
closest relevant surface (CLI, API, UI or runtime). Inspect current installed
version, API/types and authoritative sources for external contracts; do not
assume old runtime documentation. Scan affected code for transitional/deprecated
paths and reconcile migration notes/changelog.

Exercise the real integration boundary. Mocks establish parsing/fallback only.
For native Verification acceptance execute exit 0, record same-session receipt,
verify exact revision and gate; execute a nonzero command and require refusal of
a passed receipt; modify product working state and require old receipt rejection
for the new fingerprint. Keep actual requiredChecks nonempty. If hooks cannot
associate execution and receipt, report the boundary unresolved and do not claim
architecture stable. No Review or second judging LLM is required.

Inspect failures adversarially within the requested scope. Resolve routine fixes
without a continuation question. Report exact checks, met obligations and real
remaining limitations; never turn untested assumptions into successful evidence.

Run the bundled `scripts/runtime-acceptance.mjs` for the installed OpenCode V2
boundary. Set OPENCODE_BIN only to select a binary. It uses isolated fixtures,
a deterministic model driver and actual native tools/hooks/storage; no external
LLM credentials are required. A failing assertion leaves architecture acceptance
unresolved. Its JSON report identifies proof and limitations.
