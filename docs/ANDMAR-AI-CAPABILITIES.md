# AndMar AI — Capabilities Guide

Canonical per-capability reference. This document is the compact source for
deciding whether a concern belongs in a capability, a policy, a workflow, or a
skill. The integration rules for adding one live in
[CAPABILITY-CONTRACT.md](CAPABILITY-CONTRACT.md); the objective id/version/tool
index is generated in [CAPABILITIES.md](CAPABILITIES.md).

## Principles

AndMar AI is capability-oriented, not agent-oriented. OpenCode V2 owns execution, sessions, permissions, models, VCS, worktrees, and UI. AndMar adds small reusable constraints and stateful primitives only where prompts are not reliable enough.

Rules:

1. Prefer deterministic code, schemas, metadata, VCS, hashes, state, and events.
2. A capability should be self-contained and should not import sibling capabilities.
3. Installed does not mean activated.
4. Never escalate authority beyond the parent session.
5. Durable operational state belongs in `ctx.storage`, not in semantic memory.
6. Add a capability only for demonstrated friction.

Each section below answers the same contract: purpose, non-goals, primitives
with inputs/outputs, what it produces/consumes, what state it owns and must
not own, configuration, external contracts, interaction with other
capabilities, failure behavior, security boundaries, testing contract, and
known limitations.

## Implemented capabilities

### `system`

- **Purpose:** Core safety rails, harness status, and a lightweight durable
  tool-execution journal for diagnostics.
- **Non-goals:** Not a test runner, not memory, not a completion proof.
- **Public primitives:** `andmar_status` (no input; outputs harness version,
  OpenCode version, durable worker records, configured model profiles).
- **Produces:** `runtime/last-start` startup metadata; `journal/` observations.
  **Consumes:** nothing from sibling capabilities.
- **Owns:** `runtime/*`, `journal/*`. **Must not own:** worker, verification,
  or intake keys.
- **State:** `journal/<sessionID>/<callID>` per observed tool call (tool,
  status, session, call id, timestamp); keyed by the stable `execute.after`
  `event.id`. Diagnostic only.
- **Configuration:** `shell.maxTimeoutMs` (caps OpenCode's native shell
  timeout through `create.before`; AndMar runs no subprocesses itself).
- **External contracts:** `ctx.tool.hook("execute.after")`,
  `ctx.shell.hook("create.before")` (see [OPENCODE-V2.md](OPENCODE-V2.md)).
- **Interaction:** none required; other capabilities reuse the storage adapter
  contract, not this capability.
- **Failure / fallback:** hook disposal on teardown; journal writes never
  block tool execution.
- **Security / trust:** journal stores metadata only, never secrets or full
  outputs. Shell capping only lowers timeouts, never raises them.
- **Testing contract:** deterministic config/state unit tests; hook behavior
  verified against the installed `@opencode/plugin`, never the offline shim.
- **Known limitations:** the journal is unbounded (no pruning yet); it is
  diagnostics, not completion evidence.

### `routing`

- **Purpose:** Deterministic minimum-sufficient model profile selection so
  trivial work does not consume frontier models.
- **Non-goals:** Not a semantic classifier; not a model provider adapter
  (OpenCode owns the catalog).
- **Public primitives:** `andmar_route` (input: `TaskSignals` —
  `kind` required plus scope, risk, uncertainty, reasoning, public API,
  external side effects, verification failures, optional `requestedProfile`;
  output: `{ profile, minimum, model }`).
- **Produces:** a profile decision. **Consumes:** `TaskSignals`, including
  `routeSignals` reused directly from `andmar_intake` (same
  `ChangeKind`/`Risk` taxonomy, no parallel classifier).
- **Owns:** no state keys. **Must not own:** any persisted state.
- **State:** stateless.
- **Configuration:** `models.{fast,standard,frontier}` (`ModelRef` values
  already valid in OpenCode; missing mappings inherit the parent session
  model — the harness never invents provider/model IDs).
- **External contracts:** none beyond the configured `ModelRef` shape.
- **Interaction:** `delegation` applies the same `minimumProfile()` /
  `clampRequestedProfile()` policy; `intake` feeds it signals.
- **Failure / fallback:** unknown or missing signals resolve conservatively
  (`standard` or higher, never below the deterministic minimum). Escalation is
  monotonic (`fast -> standard -> frontier`); there is no automatic downgrade.
- **Security / trust:** a task may request a stronger profile, never a weaker
  one than the deterministic minimum.
- **Testing contract:** pure `minimumProfile`/`clampRequestedProfile` unit
  tests (`tests/model-policy.test.ts`).
- **Observability:** emits `andmar.routing` with the selected/minimum
  profile and bounded task signals; never task text or model output.
- **Known limitations:** coarse by design; genuinely ambiguous semantic
  routing waits for measured friction before any classifier is added.

### `delegation`

- **Purpose:** Bounded native OpenCode child sessions for work that benefits
  from separate context or a different model profile.
- **Non-goals:** Not an agent taxonomy, not a workflow engine, not a
  permission system (relies on OpenCode's native inheritance).
- **Public primitives:** `andmar_delegate` (input: `task` + `kind` required,
  optional title and routing signals; output: `{ sessionID, profile, result }`
  with result truncated to `maxResultChars`); `andmar_resume` (input:
  `sessionID` + `task`; continues an owned child instead of rebuilding
  context).
- **Produces:** child sessions plus durable `WorkerRecord` handles.
  **Consumes:** routing policy (`minimumProfile`/`clampRequestedProfile`).
- **Owns:** `workers/<parent>/<child>`, `worker-by-session/<child>`.
  **Must not own:** verification receipts or evidence.
- **State:** `WorkerRecord` (`sessionID`, `parentSessionID`, `profile`,
  `depth`, `status`, timestamps). Depth is derived from the reverse lookup so
  nesting is bounded by `maxDepth`.
- **Configuration:** `delegation.maxDepth` (1–8, default 3),
  `delegation.maxResultChars` (500–50,000, default 4000).
- **External contracts:** `ctx.session.get/create/prompt`; OpenCode child
  sessions inherit the permission rules in effect at creation.
- **Interaction:** uses the routing policy; completion evidence for delegated
  work still flows through `verification` + `lifecycle` in the parent.
- **Failure / fallback:** max depth denies delegation with an instruction to
  resolve directly; child failure is recorded (`failed`) and rethrown; resume
  by a non-owner parent is denied; a brand-new parent session must not silently
  take ownership of an old child.
- **Security / trust:** delegation never raises authority; the child transcript
  stays in the child session and the parent receives only a bounded result.
- **Testing contract:** deterministic unit tests for truncation/depth helpers
  where isolated; real session behavior is manual (see [TESTING.md](TESTING.md)).
- **Observability:** emits `andmar.delegation` for delegate/resume
  started/completed/failed/denied lifecycle metadata; child task/result text
  is never emitted.
- **Known limitations:** no project-level active-task record: after an
  OpenCode restart there is deliberately no cross-session takeover. If that
  becomes repeated friction, it is evidence for a minimal `workflow`
  capability, not a reason to weaken ownership.

### `lifecycle`

- **Purpose:** Deterministic documentation impact, SemVer impact detection, and
  the exact-revision completion gate.
- **Non-goals:** Does not write documentation, bump versions, publish
  releases, or run checks.
- **Public primitives:** `andmar_change_impact` (input: `changedPaths` +
  explicit `kind`, optional `breaking`; output: docs impact, version impact,
  public-surface flag); `andmar_completion_gate` (input: `currentRevision` +
  `CompletionEvidence`, optional `requiredChecks` defaulting to
  `tests, typecheck`, plus optional `requireContract`, `requireReview` and
  `taskKind`; output: `{ ok, reasons }`).
- **Produces:** staleness obligations and gate verdicts. **Consumes:**
  configured documentation rules and public paths; verification receipts via a
  read-only scan of `verification/` + `verification-evidence`; the active
  Task Contract and its reviews via core key helpers (read-only).
- **Owns:** no state keys of its own. **Must not own:** receipts, evidence,
  contracts, or reviews (reads them; `verification` and `task-contract`
  write them).
- **State:** stateless itself; evaluates `verification/<revision>/<check>`
  receipts owned by `verification`.
- **Configuration:** `documentation.rules` (unique ids, `code`/`docs` glob
  patterns with `*`/`**`/`?`), `versioning.enabled` and
  `versioning.publicPaths`.
- **External contracts:** none; pure mapping and SemVer policy.
- **Interaction:** `andmar_verify_revision` (`verification`) is the natural
  predecessor of the gate; the gate additionally enforces the
  required-verification invariant.
- **Failure / fallback:** with non-empty `requiredChecks`, a manual
  `testsPassed: true` can never formally verify a revision with
  missing/failed/unverified receipts. `requiredChecks: []` is the explicit,
  observable opt-out for tasks that genuinely require no checks. When a
  Task Contract exists for the session, the gate additionally denies
  completion with pending/blocked requirements, satisfied requirements
  without evidence, stale revision-bound evidence, or a missing/rejected/
  stale required review; `requireContract: true` demands a contract even
  when none exists. Without a contract the gate keeps its legacy behavior
  for trivial tasks.
- **Security / trust:** detection only — it flags obligations; the agent or
  human resolves them. Version impact is conservative and never mutates
  `package.json`, tags, or releases.
- **Testing contract:** deterministic unit tests for path mapping, SemVer
  classification, and exact-revision completion (`tests/lifecycle.test.ts`,
  `tests/glob.test.ts`).
- **Observability:** emits `andmar.completion` with the final gate verdict,
  lifecycle statuses and verification counts, including whether required
  verification prevented an otherwise claimed completion — plus contract
  metrics (`requirementsTotal/Satisfied/Pending/Blocked`,
  `requirementGatePreventedCompletion`) and review metrics
  (`reviewRequired`, `reviewRounds`, `reviewRejectCount`, `finalCompletion`).
- **Known limitations:** mapping quality depends on configured rules; semantic
  breaking-change detection beyond explicit `breaking` is out of scope.

### `verification`

- **Purpose:** Turn "the agent says it finished" into evidence that can be
  checked: which checks ran, on which exact revision, and whether they passed.
- **Non-goals:** Never executes commands itself; never judges whether tests
  are good; never publishes or versions anything.
- **Public primitives:** `andmar_suggest_checks` (input: file listing +
  optional package scripts obtained with native OpenCode tools; output:
  suggested commands labeled `script`/`config`/`convention`; executes
  nothing); `andmar_record_receipt` (input: `revision`, `check`, `passed`,
  exact `command`, optional truncated `output`; no `executionId` accepted —
  AndMar resolves the observed execution internally by current session plus
  normalized command); `andmar_verify_revision` (input: `currentRevision`,
  optional `requiredChecks` defaulting to `tests, typecheck`; output:
  `ok`/`missing`/`failed`/`unverified`/`reasons`).
- **Produces:** `verification/<revision>/<check>` receipts bound to internally
  resolved executions. **Consumes:** observed `execute.after` evidence.
- **Owns:** `verification/*`, `verification-evidence/*`. **Must not own:**
  worker or journal keys.
- **State:** one minimal evidence record per observed non-AndMar tool call
  (session, internal call id, tool, command + normalized form, status,
  timestamp, optional sha256 digest — never full outputs); one receipt per
  check per exact revision. Revisions are `encodeURIComponent`-encoded so `/`
  cannot collide.
- **Configuration:** none of its own; toolchain detection is driven by caller
  input, not config.
- **External contracts:** the stable `execute.after` hook
  (`ctx.shell` offers only `create.before` with no result, so there is no
  better observation point). AndMar-owned tool calls are never eligible as
  check evidence (no self-attestation).
- **Interaction:** predecessor of `lifecycle`'s completion gate
  (`implementation -> verification -> completion gate -> done`).
- **Failure / fallback:** fail-closed matching — nonexistent execution,
  different command, failed-as-passing, other-session execution, and
  revision-bound evidence are all refused without creating a receipt. Command
  normalization is whitespace-only (trim + collapse); any other representation
  difference must be re-run with the exact same command. Evidence without a
  command can never satisfy command-bound receipts.
- **Security / trust:** `passed: true` alone is never evidence; receipts derive
  only from OpenCode-observed executions, never from LLM claims. Evidence binds
  to one revision on first use and can never satisfy another.
- **Testing contract:** 13+ deterministic tests for receipts, evidence
  resolution, and toolchain detection (`tests/verification.test.ts`,
  `tests/verification-flow.test.ts`); mocked shapes prove parsing, never live
  hook behavior.
- **Observability:** emits `andmar.verification` for stored receipt outcomes,
  rejected receipt attempts (structured category only), and revision-summary
  counts; commands, revisions, rejection text and outputs are not sent.
- **Known limitations:** revision capture takes the revision as explicit
  input (no VCS automation yet); evidence and receipt stores are unbounded
  (no pruning yet); only the latest same-session same-command execution wins.

### `intake`

- **Purpose:** Request-refinement pilot: decide whether a natural-language
  request is sufficient or needs an Internal Task Brief before execution.
- **Non-goals:** Not a prompt enhancer, not free-text generation, not a
  workflow, memory, scoring, or telemetry system.
- **Public primitives:** `andmar_intake({ request })` (output: `taskKind`,
  `needsRefinement`, `specificationSufficiency`, `risk`/`riskLevel`,
  `externalContract`, `productDecisionMissing`, `source`, Jev metadata,
  reusable `routeSignals`, brief sections); `andmar_intake_trace({ limit })`
  (recent structured decisions for tuning).
- **Produces:** an `IntakeDecision` whose `routeSignals` feeds `andmar_route`
  directly. **Consumes:** repo context (via the primary model building the
  brief, not via Jev) and one structured Jev decision when useful.
- **Owns:** `intake-trace/*`. **Must not own:** any other capability's keys.
- **State:** `intake-trace/<timestamp>-<rand>` (max 20 entries, pruned oldest
  first): timestamp, session, request sha256 hash + length, Jev model,
  called/available flags, source, reason, latency, raw typed answers, and the
  refinement outcome. Full request text only with `ANDMAR_INTAKE_TRACE_CONTENT=1`.
- **Configuration:** capability-local `intake.model` / `intake.timeoutMs`
  (kept out of core so core stays free of Jev/OpenRouter specifics) plus
  environment: `OPENROUTER_API_KEY` (required for live Jev, never stored or
  logged), `ANDMAR_INTAKE_MODEL`, `ANDMAR_INTAKE_TIMEOUT_MS`,
  `ANDMAR_INTAKE_TRACE`, `ANDMAR_INTAKE_TRACE_CONTENT`. Plugin options win over
  environment only when explicitly set; timeout clamps to 1000–60000 ms.
- **External contracts:** exactly one `POST /api/alpha/decisions` per
  non-trivial request with six typed questions (`task_kind` as `choice` over
  the existing 12 `ChangeKind` values, `needs_refinement` /
  `external_contract` / `product_decision_missing` as `noul`,
  `specification_sufficiency` / `risk` as `score`); no free text, no SDK
  (plain `fetch`).
- **Interaction:** strict order — deterministic first, Jev second, generative
  reasoning only when necessary. Empty/oversized requests and the trivial
  bypass (short UI/text change, no migration/security/external/bug signals)
  never call Jev. `routeSignals` reuse the `ChangeKind`/`Risk` taxonomy.
- **Failure / fallback:** never blocks. Missing key, timeout, network failure,
  non-2xx, or invalid payload degrades to an explicit `fallback` with
  `needsRefinement=false` so AndMar continues with current capabilities. Jev is
  an optional decision primitive, not a requirement for AndMar to work.
- **Security / trust:** the API key is sent only as a bearer header and never
  stored, logged, or returned; trace stores hashes by default and never
  secrets. This pilot is experimental: thresholds and heuristics are tuning
  candidates, not settled policy.
- **Testing contract:** mocked unit tests prove fallback/parsing, not live Jev
  quality (`tests/intake.test.ts`); live behavior is a manual smoke script
  (`scripts/intake-smoke.mjs`, never CI).
- **Known limitations:** deterministic heuristics are cheap keyword guesses —
  Jev is the authority when available; `publicApi` is always `false` in
  `routeSignals` (public-surface detection stays in `andmar_change_impact`).

### `task-contract`

- **Purpose:** Persist and update the active Task Contract — the small,
  bounded record of what the user actually asked for (goal, explicit
  requirements, constraints, requirement evidence) — plus bounded
  independent review rounds, so implementation finishing is never confused
  with the user's request being fulfilled.
- **Non-goals:** Not a workflow engine, plan, specification system, memory,
  TODO list, DAG, swarm, or ODD/RDD infrastructure. No priorities, scores,
  weights, or percentages.
- **Public primitives:** `andmar_task_contract` (single tool, `op`:
  `create` with goal/desiredOutcome/requirements/constraints plus optional
  verificationSurface/reviewRequired and deterministic `REQ-N`/`CON-N` ids;
  `status` returning a compact reinjectable brief with counts; `update` for
  requirement transitions; `record_evidence` binding one evidence pointer of
  type `verification`/`runtime`/`diff`/`review`/`user-decision`/`external` to
  a requirement; `steer` appending new obligations without removing;
  `close` marking `completed`/`blocked`); `andmar_request_review` (input:
  `revision` plus bounded `changedPaths`/`verificationSummary`/
  `knownLimitations`; builds a compact adversarial packet from the stored
  contract and runs it in a fresh frontier-profile child session).
- **Produces:** the session's active contract and up to two review records.
  **Consumes:** routing-adjacent triviality/review-need helpers from core.
- **Owns:** `task-contract/<sessionID>`,
  `task-contract-review/<sessionID>/<round>`. **Must not own:**
  verification receipts/evidence, worker, journal, or intake keys.
- **State:** contract (`goal`, requirements with status/evidence/reason,
  constraints, `reviewRequired`, `active`/`blocked`/`completed`) and review
  records (`round`, fresh `reviewSessionID`, `revision`, `verdict`,
  `findings`, `notes`). No transcripts, chain-of-thought, prompts, or
  source code.
- **Configuration:** none of its own; reviewer model is the configured
  `frontier` profile or the parent session model (never a hard-coded id).
- **External contracts:** `ctx.session.get/create/prompt` (same native
  pattern as `delegation`; verified against the installed
  `@opencode/plugin@2.0.4` types — see [OPENCODE-V2.md](OPENCODE-V2.md) for
  the read-only and compaction findings).
- **Interaction:** `lifecycle`'s completion gate reads the contract and
  reviews through core key helpers (never writes them); `delegation`
  ownership is untouched (review sessions are not worker records, so
  `andmar_resume` denies them).
- **Failure / fallback:** duplicate active `create` refused (steer
  instead); absurd requirement transitions refused; `blocked`/`skipped`
  without reason refused; steering a `completed` contract refused; review
  without a contract refused; rounds beyond two return `blocked`; invalid
  reviewer output is reported and consumes no round. Trivial tasks skip the
  contract entirely (proportional escape hatch).
- **Security / trust:** review sessions inherit parent permissions like any
  native child and are additionally prompt-constrained to read-only review
  (no technical read-only primitive exists in the installed V2 API);
  reviewers never edit or fix. Evidence stores pointers, never content.
- **Testing contract:** deterministic unit tests for creation, steering,
  pending/evidence/blocked/stale gates, review validation, freshness, round
  cap, and trivial bypass, plus tool-level positive/negative smoke through
  the completion gate (`tests/task-contract.test.ts`).
- **Observability:** emits `andmar.contract` (action plus requirement
  counts, never texts) and `andmar.review` (round, verdict, finding
  counts, never packet or output).
- **Known limitations:** reviewer read-only is prompt-enforced, not
  API-enforced; compaction continuity is pull-based (`status`) because
  hijacking the compaction summary would destroy context; reviewer output
  quality depends on the model behind the `frontier` profile (without a
  mapping it inherits the parent model — a weak reviewer may need several
  re-requests; verdict parsing is tolerant but a reviewer that never emits
  final text leaves the review round unstored); real OpenCode runtime
  smoke is covered by manual testing (see [TESTING.md](TESTING.md)).

## AndMar primary agent

`AndMar` is not a capability. It is a custom OpenCode primary agent that applies the existing primitives as a completion policy while still using native OpenCode tools for implementation.

```text
Build  -> plain OpenCode
Plan   -> analysis
AndMar -> OpenCode + AndMar guarantees
```

The agent intentionally remains model-agnostic.

## Candidate capabilities

Candidates are evidence-driven, not a build queue.

### `workflow`

Trigger: repeated real-world friction coordinating task state, completion contracts, resume, or bounded review/correction loops.

Start small. The first implementation should solve the observed problem before adding generic DAGs or a workflow DSL.

### `decision`

The narrow slice of this idea is implemented: the `intake` pilot above makes
one typed Jev decision per request. Any broader semantic-decision use (ambiguous
profile selection, relevance scoring, small gates) still needs its own measured
trigger and must never become a general reasoning replacement.

### `context`

Trigger: measured repeated token/context waste. Deterministic retention first, semantic classification only if needed, fail-open to full context.

### `workspace`

Trigger: parallel writers need isolation beyond native OpenCode worktrees or repeatedly pay meaningful cache/setup cost.

### `impact-analysis`, `docs-integrity`, `release`, `git-policy`, `budget`, `observability`, `recovery`

Add only when the corresponding friction is demonstrated.

### `memory`

Low priority for the harness. Memory is not operational state, history, or context. Prefer an external OpenCode memory plugin unless AndMar-specific semantics become necessary.

## Boundary test for a new capability

Before adding one, ask:

```text
1. Does OpenCode V2 already solve it?
2. Does an existing package/plugin solve it?
3. Can a small deterministic function solve it?
4. Is the behavior reusable across projects/tasks?
5. Does it need durable state?
6. Could it simply be a skill/prompt?
7. Can an existing capability be extended without coupling responsibilities?
```

If a normal capability requires broad core edits, re-evaluate the boundary.

## Anti-patterns

Avoid:

```text
one capability per command
one capability per agent
capability importing capability
hard-coded model IDs
LLM routing every decision
automatic activation of everything
general DAG before evidence
memory used as task state
verification that bypasses OpenCode permissions
worker self-report treated as completion proof
```

The governing rule remains:

> Add only the next capability that resolves a measured friction.
