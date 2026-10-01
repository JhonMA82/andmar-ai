---
name: andmar-work-ledger
description: Initialize, query, transition and recover portable repository work. Use when Intake selects lightweight or structured work, or a task needs continuity across sessions and machines.
---

Keep Markdown under `.andmar/work/<work-id>/` as portable durable truth; use the
structured interface as the machine API. Never copy the Ledger into ctx.storage.

Initialize with `andmar_work({op:"init",workId,payload})`. Supply semantic goal,
title, mode (`lightweight` or `structured`), requirement texts, constraint texts
and units. Each unit supplies title, explicit requirements (`["REQ-1"]`),
acceptance, optional constraint IDs and expectedFiles. In structured mode supply
the obligation-preserving source, redacting literal credentials. IDs are assigned
by the serializer in input order. No manual Markdown serialization or EV counter.

Bind/recover existing work with `andmar_work_status({workId})`. Query status
without rereading WORK.md. Load `andmar_work_context({})` for the active WU;
select `unit`, `requirement`, `constraint` or `evidence` for a precise expansion.
Use `{document:"SOURCE.md",section:"Request"}` only when source is needed.
A `document` without a section explicitly requests a full document and is exceptional.
Restart uses the same workId and structured projections; do not redo done WUs.
Reconstruct missing runtime obligations one-to-one from targeted REQ/CON queries.

Call `andmar_work` for normal `activate`, `complete`, `block`, `reopen`, `touch`
and `record-evidence`; payload holds `unit`, `reason`, `files` or `evidence`
as appropriate. Record evidence with `{description}`; use `{id,description}`
only to fill a known placeholder. Pending is replaced; real evidence never
silently overwrites. Complete using the returned EV ID. Completion activates
the next pending WU deterministically. Reopen only invalidated outcomes, with a
reason. `touch` reconciles actual product files when observation reports gaps.

Necessary discovered work uses `andmar_work_amend`: provide explicit goal/scope,
risk, human-decision, reversibility, contradiction and obligation facts. Routine
related discoveries continue under existing REQs. Material exceptions checkpoint.
Resolve human checkpoints through `andmar_work_resume({reason})` after the actual
decision; update affected portable obligations and steer Task Contract first.
Native targeted edits for material semantic steering are exceptional: validate
with `andmar_work({op:"validate"})` before continuing. Never mutate WU markers
or append evidence manually in the normal loop.

If status reports `recoveryRequired`, inspect diagnostics with validate and
native read/search. Repair only the named Ledger files using native edit/write,
then validate and refresh work_status. Product mutation/completion remain blocked;
do not use shell or a new workId to evade recovery/checkpoints.

Offline/operator and unbound script access uses the same implementation:
`node "${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/plugins/andmar-ai/scripts/andmar-work.mjs" <operation> .andmar/work/<work-id> '<JSON payload>'`.
Use `@payload.json` for large semantic input. CLI resume is trusted offline
recovery, never a workaround in a blocked session. After completionReady and a
successful completion gate, `finalize` with `{revision: acceptedRevision}` seals
the portable Ledger. See andmar-verification for that boundary.
