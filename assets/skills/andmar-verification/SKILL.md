---
name: andmar-verification
description: Verify exact working state from real native executions and close runtime obligations. Use after meaningful code changes or before claiming completion.
---

Select checks from repository policy and `andmar_suggest_checks` when needed.
Run meaningful checks proportional to the change. Fix reversible failures
autonomously. Before long checks state purpose and expected scope; report progress.

Capture the fingerprint with the installed
`plugins/andmar-ai/scripts/working-state-revision.mjs` under OPENCODE_CONFIG_DIR
(default `$HOME/.config/opencode`). It covers HEAD, staged, unstaged and untracked
product changes; .andmar/work metadata is excluded. HEAD alone is insufficient.

Run the exact command through native OpenCode shell. Then call
`andmar_record_receipt({revision,check,passed,command})` in the same session,
using the exact command and honest outcome. The execute.after observer must back
it; the flag alone proves nothing. A nonzero exit/signal/timeout cannot pass.
No agent-supplied executionId is needed. Call `andmar_verify_revision` for the
currentRevision and actual requiredChecks. Mutating product state invalidates
old receipts; recapture and rerun affected checks. Do not bypass a missing receipt.

Record Task Contract requirement evidence with precise pointers on this revision
and satisfy each real obligation. Passing tests cover only their exercised surface;
use andmar-acceptance for user-visible claims. Evaluate `andmar_change_impact`,
update necessary docs/version/changelog and recapture/reverify if state changed.

For bound Ledger work require `andmar_work_status` completionReady. Call
`andmar_completion_gate` with currentRevision, taskKind, docsStatus, versionStatus
and actual requiredChecks. Stored exact-revision evidence and requirements decide
the result. The successful gate closes the Task Contract itself. task_contract
close is cancellation only. Finalize the portable Ledger with the accepted
revision via the installed andmar-work helper. Do not introduce another gate.

Intake continuation.fastPath after completion keeps taskKind internal and the
completed contract/Ledger closed. Load andmar-git-lifecycle for delivery; do not
repeat integrated verification solely because the user requests push/version.
