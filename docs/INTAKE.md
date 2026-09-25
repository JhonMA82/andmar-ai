# Intake — Request Refinement pilot

Intake turns a human request into a technical intent clear enough for AndMar
to work with consistent quality. It is not a prompt enhancer: it discovers
the missing technical layer from repo context and a small structured
decision, then lets the primary model do the reasoning only when necessary.

Jev is an optional decision primitive here, not a requirement: without a key,
on timeout, or on any failure, intake degrades to an explicit non-blocking
`fallback` and AndMar continues with current capabilities. This pilot is
experimental — questions, thresholds, and heuristics are tuning candidates
driven by trace data, not settled policy.

```text
User request
     ↓
AndMar primary agent
     ↓
andmar_intake
     ↓ deterministic checks
     ↓ when useful
Jev decision (one call, six questions)
     ↓
sufficient ──────────────→ normal execution
     │
     └── needs refinement
                 ↓
       Internal Task Brief (primary model + repo context)
                 ↓
              andmar_route
                 ↓
             execution
```

Jev never generates the brief. Jev only answers typed questions. The primary
model builds the brief when `needsRefinement=true`.

## Capability

`src/capabilities/intake/` — no new agent, workflow, service, or runtime.

Primitives:

- `andmar_intake({ request })` — structured decision for one request.
- `andmar_intake_trace({ limit })` — recent structured decisions for tuning.

## When Jev is called

Order is strict:

```text
deterministic first
Jev second
generative reasoning only when necessary
```

1. **Invalid** (`""`, whitespace, `>100000` chars) → immediate `fallback`
   (`invalid_request` / `request_too_large`), no Jev. The higher raw-request
   ceiling exists so long human specifications can reach Intake intact; it
   does not enlarge Jev's decision context.
2. **Trivial bypass** — short UI/text change with no migration, security,
   external, or bug signals (e.g. `Cambia Save por Guardar`) → `deterministic`,
   `jevCalled=false`, no Jev call. Proportionality for tiny work.
3. **Missing `OPENROUTER_API_KEY`** → `fallback` (`missing_api_key`),
   deterministic guess, non-blocking.
4. **Otherwise** → exactly one `POST /api/alpha/decisions` with six questions.
   Success → `source=jev`. Timeout, network failure, non-2xx, or invalid
   payload → `fallback` with `reason=timeout|request_failed|auth_failed|invalid_response`
   and `jevCalled=true`.

## Questions (one Jev call)

| id | type | meaning |
|---|---|---|
| `task_kind` | `choice` | 12 AndMar kinds: `trivial-ui`, `docs-format`, `known-test`, `feature`, `bugfix`, `refactor`, `debug`, `architecture`, `security`, `migration`, `review`, `internal`. Same taxonomy as `andmar_route`; no second taxonomy. |
| `needs_refinement` | `noul` | `true` probability the request is too vague to execute with quality. Threshold `>=0.5`. |
| `specification_sufficiency` | `score` | `0–4`: empty → goal only → partial → clear → fully specified. |
| `risk` | `score` | `0–3` → `low|medium|high|critical` for `andmar_route`. |
| `external_contract` | `noul` | Upstream API, migration compat, auth provider, webhook, runtime boundary. |
| `product_decision_missing` | `noul` | Real product choice missing that repo context cannot resolve. |

`task_kind` maps 1:1 to `ChangeKind`. `risk` score maps to `Risk`.
`routeSignals` (`kind`, `risk`, `uncertainty` from sufficiency, `reasoning`
from kind+sufficiency, `publicApi=false`, `externalSideEffects=externalContract`)
feeds `andmar_route` directly — no parallel classification system.

Full definitions live in `src/capabilities/intake/questions.ts`.

## Fallback (never blocks)

```json
{
  "source": "fallback",
  "jevAvailable": false,
  "reason": "missing_api_key",
  "taskKind": "feature",
  "needsRefinement": false
}
```

Reasons: `missing_api_key`, `timeout`, `request_failed`, `auth_failed`,
`invalid_response`, `invalid_request`, `request_too_large`. Fallback never
blocks AndMar. Normally it keeps `needsRefinement=false`; however, when the
raw request is larger than Jev's decision-state window, Intake forces
`needsRefinement=true` so the primary model reviews the **full raw request**
before execution. The deterministic `taskKind` guess is still labeled
`fallback`, never `jev`.

## Internal Task Brief (primary model, not Jev)

When `needsRefinement=true`, build internally from the **full raw user
request** plus repo, package manager, config, code, tests, docs, upstream, and
AndMar capabilities. Do not ask the user for anything discoverable.

The brief is a derived execution aid, not a replacement specification. The raw
request remains authoritative for explicit requirements and constraints.
Compression may remove repetition or explanatory prose, but never obligations.
Contradictory requirements must be surfaced and resolved from authoritative
context when possible; if a real product choice remains, ask the user rather
than silently choosing a side.

Sections only — no rigid phases, no PRD for small tasks:

```text
Intent
Relevant context
Constraints
Acceptance criteria
Risks / external contracts
Unresolved product decisions
```

Before creating the Task Contract, compare the compact projection against the
raw request. Every explicit requirement and constraint must remain represented
or be explicitly identified as contradictory/unresolved.

Ask the user only for a real product decision that cannot be resolved
responsibly from context (`productDecisionMissing=true` is the signal).

## Trace

Disabled by default. Reuses AndMar `ctx.storage` under `intake-trace/`,
max 20 entries. No observability system, no remote telemetry.

```bash
ANDMAR_INTAKE_TRACE=1            # enable (restart opencode service)
ANDMAR_INTAKE_TRACE_CONTENT=1    # also store full request text (dev only)
```

Query:

```text
andmar_intake_trace({ limit: 10 })
```

Stored by default: `timestamp`, `sessionID`, `requestHash` (sha256),
`requestLength`, `jevModel`, `jevCalled`, `jevAvailable`, `source`,
`reason`, `latencyMs`, raw `answers` (type+value+confidence/probabilities/
legend as returned — never invented; `noul` has no confidence by design),
`decision.refine`. Full `request` only with the content opt-in. `OPENROUTER_API_KEY`
is never stored, logged, or returned.

## Configuration

No new dependency. Plain `fetch` against the verified Decisions contract;
`@openrouter/sdk` was reviewed and rejected for this pilot (contract is one
POST + validation; SDK adds weight for no structural gain).

```bash
OPENROUTER_API_KEY=sk-or-v1-...   # required for Jev; never stored/logged
ANDMAR_INTAKE_MODEL=typesafe/jev-1.13
ANDMAR_INTAKE_TIMEOUT_MS=8000
ANDMAR_INTAKE_TRACE=1
ANDMAR_INTAKE_TRACE_CONTENT=1
```

Plugin options (optional, same keys under `intake`). An explicitly set plugin
option wins over the environment variable; otherwise the environment applies;
otherwise the default:

```jsonc
{ "intake": { "model": "typesafe/jev-1.13", "timeoutMs": 8000 } }
```

Model resolution lives in the capability. `src/core/jev-client.ts` holds only
the shared Decisions transport (endpoint, fetch and payload shape) reused by
review routing in `task-contract`; no provider policy lives in core.

## Contract verification (2026-09-21)

- Live OpenAPI: `POST https://openrouter.ai/api/alpha/decisions`
  (`/api/v1/alpha/decisions` 404s; `/chat/completions` rejects Jev models).
- Body `{ model, state, questions }`; `state` is the raw request (truncated at
  8000 chars for the 32k context).
- Response `{ model, answers, usage }`; `answers` keyed by question id.
- `noul` → `{ type, noul }` (value is the probability, no confidence).
- `choice` → `{ type, choice, confidence?, probabilities? }`.
- `score` → `{ type, score, confidence?, probabilities?, legend? }`.
- Default pilot model `typesafe/jev-1.13` (served as
  `typesafe/jev-1.13-20260917`); configurable without core coupling.

## Manual matrix (with trace on)

```text
"Cambia Save por Guardar"                  # deterministic bypass, no Jev
"Agrega validación al formulario"          # feature, likely refine
"Haz que no se puedan falsificar los receipts"  # security, refine
"Migra este plugin a OpenCode v2"          # migration + external, refine
"Agrega login con Google"                  # feature + external, refine
"Esto falla cuando hay dos sesiones"       # debug, refine
```

Then `andmar_intake_trace` and check: was Jev called, what it answered, why
refinement fired, fallback or not, latency. Use the evidence to tune
questions/thresholds, not intuition.

Real pilot run 2026-09-21 (`typesafe/jev-1.13-20260917`, latencies 189–376ms):
trivial bypassed Jev; other five returned `needsRefinement=true`,
`sufficiency=1`; `security`→critical+external, `migration`→high+external,
`feature+Google`→high+external, `debug`→medium, `feature+form`→medium.
`productDecisionMissing=true` fired on all five vague samples — possibly
aggressive; candidate for threshold/question tuning with more trace data.

## Smoke (manual, never CI)

```bash
OPENROUTER_API_KEY=... node scripts/intake-smoke.mjs
```

Exit `2` when the key is missing. Prints models, latencies, and raw answers;
never prints the key.

## Limits

- Jev receives at most `MAX_STATE_CHARS` (currently 8,000 chars). Intake accepts
  a larger raw request, but a decision made from partial Jev context can never
  certify specification sufficiency. Requests beyond that decision window
  force an Internal Task Brief built by the primary model from the full raw
  request.
- Mocked unit tests prove fallback/parsing, not live Jev quality.
- Deterministic heuristics are cheap guesses (Spanish/English keywords);
  Jev is the authority when available.
- `publicApi` is always `false` in `routeSignals` this pilot; public-surface
  detection stays in `andmar_change_impact`.
- No workflow, memory, scoring, embeddings, dashboard, telemetry, auto-tuning,
  or per-message evaluation. Pilot only.

## Operational continuations (D-021)

After a `completed` Task Contract, a new request that only operates on the
already-approved result fast-paths as `continuation.fastPath=true`:

```text
completed Task Contract → new request → operational continuation only?
  obvious → deterministic fast-path, no Jev
  ambiguous → same single Jev call + 3 conditional questions
```

Deterministic bypass accepts only short, unequivocally operational wording
(`sube y versiona`, `push`, `haz commit`, `commit y push`,
`actualiza la versión`, `crea el tag`); anything hinting at code/behavior
change returns to the normal flow. Ambiguous cases send one Jev call with
the base six plus `continuation_relation` / `continuation_mutation` /
`continuation_new_requirement` (state carries only request plus prior
`status`/`taskKind`, never the full contract). Fast-path requires
`operational_continuation` + non-code mutation + new-requirement `< 0.25`
(+ choice confidence absent or `>= 0.70`).

Fast-path sets `taskKind=internal`, `needsRefinement=false`,
`sufficiency=4`, low uncertainty/reasoning, and `brief.required=false`;
trace stores only `continuationFastPath`/`Relation`/`Mutation`/`Source`.
Fallback never fast-paths. No `release` capability is created.
