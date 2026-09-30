# Source audit

Inspected before implementation, on 2026-09-30 UTC. Patterns were adapted with
independently written code; no upstream implementation was copied. No MPL code
was incorporated into MIT files.

| Source / pinned revision | Inspected | Applied / deliberately omitted |
|---|---|---|
| [ai-harness-benchmark](https://github.com/bobmatnyc/ai-harness-benchmark/tree/930a705622952a0b69988c40e3aa837a1bbc4bee), MIT | `runner/run_pilot.py`, `collection/README.md`, `analysis/analyze.py`, challenge/harness/result layouts | Separate task, execution, collection and comparison; independent quality checks; per-run history. No Python framework, fixed model-family prices or inferred defaults. |
| [opencode-tokenomics](https://github.com/AeonDave/opencode-tokenomics/tree/00999fab20806406ebd876f0abfc8b695d2f60cc), MIT | `src/plugin/{aggregator,types,store,pricing,tokenizer}.ts` | Message-ID and call-ID deduplication, parent/child metadata, separate reported/API-equivalent cost, historical JSON. Native stats replace custom usage counters; no dashboard, server or speculative tokenizer breakdown. |
| [deepseek-harness token-meter](https://github.com/deepseek-ai/deepseek-harness/tree/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/token-meter), MIT | README, `src/estimate.ts`, usage/surface fold layout | Deterministic replay/final-sample principle; native prompt-size samples. A transcript is not the next model-visible envelope. Four-char estimates cannot reconstruct hidden schemas or compacted context reliably here, so no projection/compaction/context estimator was added. |
| [opencode-plugin-otel](https://github.com/DEVtheOPS/opencode-plugin-otel/tree/15e00871538382c512f3905937b9483371aeb4b2), MPL-2.0 | `src/plugin.ts`, handlers for session/step/tool | Contract reference for `session.step.*`, `session.tool.*`, retry and parent/child lifecycle; no OTel SDK, copied handlers or plugin added. |

Authoritative validation: installed `@opencode/schema@2.0.4`
`session-stats`, `session-message`, `session-event`, `token-usage`, configuration
and protocol session types; [OpenCode V2 CLI documentation](https://opencode.ai/v2/docs/cli/commands).
Read-only CLI checks against **@opencode/cli@2.0.20** confirmed:

- `run --standalone --auto --agent --model provider/model#variant --session --format json`;
- `stats --standalone --json --all --full --limit`;
- `api GET /api/session --param directory=... --param limit=...` (includes child sessions);
- `session export --standalone ID` returns `{info,messages}`.

An isolated empty session was created/exported without sending a model prompt.
Stats returned native nested `tokens.cache`, `tools.totals`, `tools.usage`,
`models`, `steps`, `sessions`, `subagents` and `cost`. CLI/project-level stats
cannot safely identify one run in a shared database. Each benchmark therefore
uses its own `OPENCODE_DB`, private server and project state, collecting the
entire database including auxiliary native usage and child sessions.

A no-route run (deliberately nonexistent provider, no model request) also proved
the actual adapter lifecycle, inherited `PWD` handling, session export shape and
AndMar's existing `runtime/last-start` record. Native session pages may expose a
next cursor on their final page; completeness is checked against the native count.
The optional read-only `kv` lookup is limited to existing activation/development
metadata; a changed internal database contract fails closed for activation.

OpenCode owns token accounting. Only absent diagnostic data is read from complete
native exports. A retry projection is not a separately billed attempt log; it
cannot recover usage that the provider never reported. Full durable-event context
replay or HTTP instrumentation would add disproportionate infrastructure and is
deferred. JEV direct-fetch usage similarly lies outside native usage; strict
same-model experiments use Intake's existing keyless fallback.
