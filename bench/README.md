# Objective efficiency benchmark

This is an opt-in experiment outside the AndMar runtime. It never changes routing,
configuration or behavior based on results. No dashboard, reviewer, service or
additional dependency is installed. Runtime version remains unchanged.

## Run the same task with Build and AndMar

Requires Bun, Node >=22.13 (built-in read-only SQLite diagnostics), Git, installed AndMar dependencies and OpenCode V2.
The native CLI/JSON contract was checked against **2.0.20** without model calls.
Use a POSIX environment (Linux/macOS/WSL) for process-tree timeout cancellation.

```bash
bun install --frozen-lockfile
bun run check
bun bench/runner.ts --execute \
  --task bench/tasks/trivial/trivial-button-text.json \
  --model 'provider/model#variant' --repeat 3 --output bench/results/button
bun bench/compare.ts --baseline bench/results/button/build \
  --current bench/results/button/andmar
bun bench/compare.ts --baseline bench/results/button/build \
  --current bench/results/button/andmar --json
```

Replace the model reference with an exact available provider/model and optional
variant. `--execute` explicitly enables model usage and possible charges. Neither
CI nor `bun run check` calls a real model. Without this flag the runner refuses.

For all eight initial tasks:

```bash
for task in bench/tasks/*/*.json; do
  bun bench/runner.ts --execute --task "$task" \
    --model 'provider/model#variant' --repeat 3 --output bench/results/initial
done
bun bench/compare.ts --baseline bench/results/initial/build \
  --current bench/results/initial/andmar
```

Eight tasks cover two trivial edits, two bugs, two features, one refactor and one
CLI/module integration. They are small calibration fixtures, not proof that a
harness performs equally well on large production repositories.

## Reproducibility and fairness

`schema.ts` owns schema version 1. Tasks pin either a full repository commit SHA
or a SHA256 of their exact initial fixture files. Their exact prompt, setup
commands, checks, allowed/forbidden files, timeout and requirement-to-check
mapping are fingerprinted. Verification commands are argument arrays, not shell
strings. Checks execute outside the model loop using immutable task definitions.
Expected files must exist; all checks, all requirements and file scope must pass.
Existing tests cannot be changed to manufacture passing verification.

Each run starts a fresh clone/fixture at the same workspace path, a fresh private
OpenCode server, config, cache and database. Setup must leave Git state clean.
The runner fingerprints the initial files, installed dependency contents, common
config, environment (hash only), OS/architecture, Node and OpenCode versions,
model, prices, benchmark code, machine/OS capacity and timeout. Any difference causes comparison to fail. External dependency symlinks are rejected. There is no
ambient project OpenCode configuration; repositories with `.opencode`,
`opencode.json(c)` or `.env` are rejected instead of silently rewritten.

For a production task, use a sanitized pinned repository with locked dependency
setup. Tasks and verification are trusted executable code, just like project
tests. Fixtures are isolated directories, not an OS security sandbox. Review a
task before running it with provider credentials.

`--config FILE` supplies identical JSON provider settings, permissions, shell,
snapshots, formatter, lsp, media, compaction, tool_output, watcher or websearch
settings. The runner owns agents, plugins and model selection: baseline has no
AndMar plugin; current loads the selected checkout and its unmodified primary
agent. Native Build/Plan/General/Explore and all AndMar profiles use the same
model reference. Observed primary/child model mismatches invalidate comparison.
`--auto` is identical in both modes; explicit native deny rules remain in effect.
The protocol is one prompt with no feedback loop; first-pass means independent
success after this single attempt, not a count of internal edits or test runs.

Credentials must come from provider environment variables or explicit common
provider settings. Isolated databases do **not** inherit stored OAuth/subscription
accounts. There is no login or credential migration helper in this benchmark.
For OpenRouter, use an alternate environment variable in common provider settings
(for example `provider.openrouter.settings.apiKey: "{env:BENCH_OPENROUTER_KEY}"`).
The benchmark removes `OPENROUTER_API_KEY` from its subprocess environment:
AndMar's existing Intake fallback then runs deterministically. JEV's direct fetch
would otherwise use another model and escape native accounting. Normal AndMar
usage is unchanged. This experiment therefore measures **JEV fallback mode**;
it cannot establish the cost/value of JEV-enabled usage. Auxiliary usage outside
native OpenCode accounting is explicitly `unmeasured`.

Client output, native stats and complete parent/child session exports remain in
each run directory alongside the task, hashes, diff and final files. These can
contain private source/prompts; generated results are ignored by Git. Store a
reviewed cohort under a deliberate historical directory or your own artifact
storage; keeping a version label alone is insufficient.

## What is measured

| Metric | Source / meaning |
|---|---|
| Tokens, cache, steps, tools, sessions, subagents, reported cost | Native `opencode stats --standalone --json --all --full` in the isolated database; not a second accounting system |
| Token total | Native V2 definition: input + output + reasoning + cache read + cache write |
| Duration | Agent attempt plus independent verification and final-state capture; setup and post-run telemetry collection excluded; agent/verification durations also recorded |
| Global tool P50 | Individual native exported call timestamps, keyed by session + call ID; never an average of per-tool medians |
| Retries | Native exported assistant retry attempts, keyed by session + message ID; null unless all sessions are exported |
| Model errors | Terminal assistant errors in complete native exports; retry errors remain represented by retries |
| Context pressure | Peak native input + cache read/write on one assistant request; no cumulative-history estimate, capacity/occupancy and system/tool breakdown remain unmeasured |
| Requirements missed | Independent declared check mapping, not the agent's own contract count |
| Success | Exit 0, no timeout/process error, objective checks, requirement mapping, expected files, scope and structural Ledger checks all pass |
| False completion | Latest observed deterministic completion-gate claim vs independent success; prose claims require human annotation |
| User corrections | Extra root user prompts in complete native exports; unmeasured when exports are incomplete |
| User interventions | Unmeasured: root corrections do not account for every possible external human intervention |
| Rework | Delta of existing `readLedgerMetrics` reopen events before/after the attempt when a complete Ledger exists; otherwise unmeasured, not inferred from failed tool calls |
| AndMar interventions/friction/usefulness/checkpoints | Existing bounded development aggregate (read-only) or naturally emitted `andmar_report`, plus existing Ledger reader; no extra diagnostic prompt/tool is injected |
| Policy amplification | Native calls whose tool name starts with `andmar_` or `andmar.`; complete product/policy/verification/delegated work attribution stays unmeasured |

Work Ledger operational files are reported separately from product changes and
any changed `WORK.md` is checked by the existing validator. They never override
the task's objective verifier. Task Contract/gate/report evidence remains in
exports; no duplicate operational state is introduced.

The optional read-only SQLite diagnostic reads only AndMar's existing
`runtime/last-start` and `development-metrics/v1/aggregate` keys. It proves the
current plugin loaded and the baseline did not, and reuses existing intervention
counters. The OpenCode `kv` encoding was checked on 2.0.20; unsupported schemas
return unknown and an unproven current harness is excluded from comparison.
This is not a second token/cost accounting store. Core/runtime state is never
written by the benchmark.

Zero native cost stays zero, including free/subscription billing. It is
provider-accounted cost, not a verified invoice. Estimated API-equivalent cost
is a separate optional field. `--pricing FILE` requires explicit exact-model
USD rates, a source and date; there are no heuristic model-name price tables:

```json
{
  "schemaVersion": 1,
  "provider": "provider",
  "model": "model",
  "currency": "USD",
  "asOf": "YYYY-MM-DD",
  "source": "provider pricing URL and applicable billing assumptions",
  "perMillion": {
    "input": 0,
    "output": 0,
    "reasoning": 0,
    "cacheRead": 0,
    "cacheWrite": 0
  }
}
```

The zero rates above are placeholders, not a price recommendation. Supply real
rates, accounting for whether reasoning is billed separately. Unsupported tiered
pricing or missing channels must remain unmeasured rather than falsely precise.

For prose completion assessment, preserve the original result and make a separate
annotated cohort with explicit assessor/evidence:

```bash
mkdir -p bench/results/assessed/build
bun bench/annotate.ts --result PATH.result.json \
  --output bench/results/assessed/build/task.result.json \
  --completion-claim true --by 'Assessor' \
  --note 'Final transcript says completed; independent check X failed.'
```

Annotate both cohorts using the same rubric before interpreting false completion.
An unobserved claim is null, not zero. This does not add a model judge or change
verification truth.

## Interpret results and compare versions

The comparator pairs task ID/repetition and rejects missing/duplicate samples,
mixed models, mismatched conditions and infrastructure failures. Task failures
remain in valid cohorts and their cost counts toward cost per successful task.
Unknown samples make the affected aggregate null; no unknown is silently zeroed.
Overhead is `(current - baseline) / baseline * 100`; zero denominator gives null.
Reported and estimated cost per success are both total cohort cost divided by
successful tasks, including unsuccessful attempts in the numerator.

Compare success and omissions before optimizing tokens. Report coverage of
human-assessed completion, model retries and Ledger rework alongside values.
Provider cache warmth, network delay, provider-side model changes and stochastic
output remain uncontrolled. Use several repetitions and alternate order (the
pair runner reverses order on odd repetitions). Repeatability means identical
inputs and analysis, not identical LLM output. These small fixtures do not yet
isolate the causal savings of routing or verification.

For historical AndMar comparisons, install dependencies in both clean checkouts
and run the **same benchmark code and unchanged task files** against each:

```bash
bun bench/runner.ts --execute --task bench/tasks/feature/feature-average.json \
  --model 'provider/model#variant' --mode andmar --repeat 3 \
  --andmar-root /absolute/andmar-v0.15.1 --output bench/results/v0.15.1
bun bench/runner.ts --execute --task bench/tasks/feature/feature-average.json \
  --model 'provider/model#variant' --mode andmar --repeat 3 \
  --andmar-root /absolute/andmar-next --output bench/results/next
bun bench/compare.ts --baseline bench/results/v0.15.1/andmar \
  --current bench/results/next/andmar --json
```

Run all eight tasks for useful cohort coverage. Results record package version,
Git revision and actual runtime source hash (including dirty changes), so two
builds sharing a version can be distinguished. A passing internal suite does
not demonstrate an efficiency improvement. Read the comparison, then make a
human decision; nothing automatically tunes the harness.

Research and retention decisions: [RESEARCH.md](RESEARCH.md),
[state retention debt](../docs/STATE.md#retention-debt-no-runtime-change).
