# Development Metrics

**Scope:** local, bounded evidence about whether AndMar adds value or creates friction.

Development metrics are **diagnostics**, not a workflow phase and never a completion gate. The public surface is `andmar_report`.

## Architecture

Runtime capabilities already emit metadata-only semantic events. `development-metrics` subscribes to that existing bus and stores one bounded aggregate in plugin state:

```text
development-metrics/v1/aggregate
```

It does not store prompts, requirement text, code, commands, tool output, reviewer text, or chain-of-thought. External observability may be disabled independently; local metrics still work.

For recovery/rework, `andmar_report` reads only the known portable path:

```text
.andmar/work/*/WORK.md
```

It does not scan the repository generally and does not write metric files into the project.

## Metrics

- **Harness Intervention Rate** = intervention events / tasks observed by Intake.
- **Harness Friction Rate** = friction events / tasks observed by Intake.
- **Useful Intervention Rate** = useful interventions / all interventions.
- **Rework Rate** = Work Unit `done -> active` transitions / Work Unit `active -> done` transitions.
- **Checkpoint Coverage** = checkpoint events / Work Unit completion transitions.

Useful interventions include preventing invalid verification evidence, blocking completion with missing/stale proof, detecting stale verification, rejecting a materially incomplete review, and stopping an unchanged-state review retry loop.

Friction currently includes duplicate exact-revision verification, reviewer timeout/invalid output, repeated review attempts AndMar must refuse, delegation failure, and failed AndMar tool execution observed by OpenCode.

## Recovery

When a completed Work Unit is reopened, lifecycle clears its active Evidence and Checkpoint pointers. If a checkpoint existed, the lifecycle history retains only the previous checkpoint SHA as bounded recovery metadata. `andmar_report` therefore reports how many reopened units had a recovery checkpoint without preserving another runtime copy of the Ledger.

## Coverage limits

The report explicitly marks facts AndMar cannot determine objectively yet:

- whether a block was a **false** block (requires human ground truth);
- duplicate-work attempts rejected before they mutate Work Ledger;
- exact commits reverted or independent work lost after a regression.

These are reported as unmeasured rather than guessed.

## Configuration

```jsonc
{
  "developmentMetrics": {
    "enabled": true
  }
}
```

The default is `true` because AndMar itself is a development harness. Set it to `false` for a complete local no-op. This controls local aggregation only; `ANDMAR_OBSERVABILITY_ENABLED=0` separately disables the optional external semantic-event sink.

## Usage

Do not call `andmar_report` on every task. Use it when diagnosing repeated harness friction, evaluating whether a capability pays for itself, or during explicit AndMar tuning.
