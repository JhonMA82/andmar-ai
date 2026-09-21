# Architectural Decisions

This is a compact decision log, not a process-heavy ADR system. Add an entry only for decisions that future maintainers/agents are likely to reconsider.

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

**Consequence:** New capability = folder + `npm run generate`.

---

## D-004 — Model profiles, not model IDs in workflows

**Decision:** Internal APIs use `fast | standard | frontier`.

**Why:** Models change faster than workflows/methodologies. Concrete model IDs should be replaceable in one configuration location.

**Consequence:** A workflow never hard-codes `gpt-*`, `claude-*`, etc.

---

## D-005 — Deterministic routing first

**Decision:** MVP routing uses structured task signals and explicit rules.

**Why:** Using a frontier model to decide whether a frontier model is needed is wasteful; a semantic classifier is not justified until ambiguous routing becomes a measured problem.

**Consequence:** Jev is an intended extension, not an MVP dependency.

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
