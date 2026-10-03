# Project Learning and Runtime Incidents

Two destinations share bounded capture/hygiene/atomic file infrastructure. Their
semantics and records remain separate. The model already working foreground is
the only semantic decision-maker. No additional model request, background agent,
Review, embeddings, provider, database or remote recorder is introduced.

## Project Learning

Native `execute.after` supplies structured status and `metadata.exit`, never
stderr interpretation. Shell/bash failure is held transiently; successful native
edit/write/patch marks a possible corrective action; the same normalized command
subsequently exiting zero produces a pending `RECOVERED_FAILURE`. An isolated
success, failure, or unexplained retry produces no lesson. Commands over 400
characters, with secrets or machine paths, are rejected conservatively. Different
commands, hook/policy refusals and unsupported process outcomes are not paired. No transcript is read.

The candidate proves a recovery pair, **not** the reusable causal procedure. The
foreground must supply its own validated conclusion and evidence before promote.
Explicit `note` supports `USER_CORRECTION`, `TECHNIQUE`, `SKILL_WRONG`; no narration,
raw tool output, unresolved hypothesis or project-only decision is accepted.

```js
await tools.andmar.learning({op: "pending"});
await tools.andmar.learning({op: "promote", id: "PL-<candidate-id>",
  name: "uv-lock-recovery", description: "Recover a uv Python lock mismatch",
  procedure: "Select the supported Python version, regenerate uv.lock, then rerun uv sync.",
  source: "foreground-validated", validated: true,
  evidence: "Reproduced failure and successful uv sync after lock regeneration"});
await tools.andmar.learning({op: "drop", id: "PL-<candidate-id>", reason: "Not reusable"});
```

Promotion writes a conventional OpenCode project skill:
`.opencode/skills/uv-lock-recovery/SKILL.md` with normal name/description
frontmatter. A successful promotion requests a non-blocking native scanner reload. It is discovered by the native scanner; there is no second skill
registry or automatic turn injection. `merge` requires `mergeInto` referencing a
promoted lesson owned by this registry, and the exact unchanged skill digest.
Foreign or user-edited skills are refused. Native skills are product changes and
invalidate older verification evidence normally. Use this procedure on demand.

Sanitation runs on candidate, audit, description, procedure and evidence writes.
Keys/tokens/credential URLs/private keys and machine paths are removed. Injection
markers, role spoofing, raw-source provenance and oversize content are refused.
Source/validation fields are explicit foreground attestations, not proof that
natural-language semantics can be decided by regex. A foreground agent can still
misjudge a lesson; conservative deterministic checks do not solve that problem.

Fingerprints plus token-set similarity deduplicate equivalent candidates.
`hits`/`lastSeen` reinforce existing records. Drops remain suppressed while their
bounded tombstones are retained. Promotion intent is audited before file writing;
an interrupted new-skill publication can be reconciled with the exact prepared
content digest. Existing edited files are never overwritten silently.

## Runtime Incidents

Internal component boundaries provide the signal: an unexpected owned hook/tool
exception, invalid Work Ledger, or a stored passed receipt whose own execution
record disappeared. Ordinary test exit 1, missing receipts because no check was
recorded yet, stale revisions and legitimate checkpoint refusals are not
incidents. Explicit record supports internal gaps that lack a native event.

The owning Ledger remains the source of truth. The sidecar stores work/WU
references, expected and last successful transition, failure component/category,
short diagnostic, versions, recoverability, recurrence count and recovery
verification evidence. It never copies the Ledger/transcript or writes task
status. `regressionCandidate` is true for repetition, severe/manual-intervention
reports or invalid-transition category. It does not generate tests or fixes.

```js
await tools.andmar.incident({op: "list"});
await tools.andmar.incident({op: "resolve", id: "INC-<incident-id>",
  recovery: "Restored the missing execute.after observation",
  evidence: "Same-revision Verification passes with valid backing execution"});
await tools.andmar.incident({op: "outcome", workId: "demo",
  outcome: "cancelled-by-user", explanation: "User explicitly cancelled this work"});
```

Explicit outcomes are `cancelled-by-user`, `blocked-external`, `failed-project`,
`failed-andmar`. `completed` is derived only from the existing Ledger's completed
transition; caller claims cannot grant it. Outcomes explain execution, never
introduce another task state machine. Cancellation/external outages cannot be
safely inferred from arbitrary tool stderr: foreground records the actual cause.

Work transition notices carry compact work/WU/next references. Verification and
Completion notices advance the observed cursor; final Ledger completion supplies
the terminal explanation. On rebinding an unfinished work reference from another
runtime instance, an interrupted-run incident preserves last valid transition
and next expected operation. Cause remains **unknown** until recovery/diagnosis;
it is not silently declared failed-AndMar. Recording occurs on rebind, not via a
daemon or a fake SIGKILL callback. Parallel live processes sharing a work reference
can look like a restart; reconcile before treating this diagnostic as a defect.

Recovery updates the original incident; an equivalent recurrence reopens it and
increments occurrences. Fingerprints exclude paths, temporary IDs, hashes,
numeric variable lines and ISO timestamps. Latest work context is retained for
an aggregated recurrence; the original first-seen timestamp remains available.
An incident never automatically becomes a project lesson. A regression/fix or an
internal recovery skill is an explicit future task, outside runtime recording.

## Storage and limits

- `.andmar/learning/records.json`: version 1 candidates, ownership and bounded
  decision audit; pending cap 64, historical lesson cap 128, audit cap 128.
- `.andmar/incidents/records.json`: version 1 incidents and work execution
  references; open cap 64, resolved cap 64, observed work reference cap 64.
- Capture: 8 sessions, 32 observations/session, 400 characters/observation.
- Summary: 400 characters; evidence: 800; procedure: 6000; registry: 256 KiB hard
  read/write cap. The byte cap can trigger before count caps for maximum-size
  records; it refuses the diagnostic write, never the user task.
- Pending writes: max 32 jobs. Notices: max 16; IO warning is once/runtime.

Files are human-readable and portable. No operational mirror is added to
`ctx.storage`. Exclusive per-directory `.write-lock` protects read-modify-write
across instances. Busy/stale lock: one warning, no wait loop; after confirming no
writer is active, remove it and retry. Writes sync a fixed temporary file and
rename atomically; a leftover temp is reused on the next successful write.
Invalid/oversize/schema-corrupt registries move to one `records.corrupt` slot and
start fresh with a warning. A corrupt registry cannot block the rest of AndMar.
Storage paths reject symlink redirects; temporary files use O_NOFOLLOW.

Diagnostic records are excluded from working-state revision, WU checkpoint
product comparison and native dirty-file touch observation. Their own writes
cannot stale Verification. They may travel with Git in consumer repositories;
AndMar's existing self-hosted `.andmar/` ignore remains unchanged.

The new capability registers no execute.before gate. Incident inspection and
learning diagnostic operations remain available during recovery/checkpoints;
learning promote/merge remains subject to existing product mutation policy.
Recorder errors are never fed back as incidents. Tools return diagnostic failures
with `nonBlocking:true`; observed native failures retain their original behavior.

The pinned plugin API exposes native progress on explicit tools and host stderr
for automatic diagnostics. Automatic notices use host stderr; status/pending/list
also return bounded notices. Visibility of host stderr depends on the runtime UI;
no custom TUI/dashboard or synthetic user/assistant message is added.

## Integration and core change

New runtime invariant lives in one `learning` capability folder. Its project and
incident modules cannot substitute for each other. Lifecycle emits compact
references and a one-time invalid-Ledger edge; Verification emits the specific
lost-backing-execution edge. Completion is consumed through its existing event.
Core's small generic capability setup adapter observes unexpected registered
hook/tool exceptions across owners, rethrows the identical original exception,
and swallows observation errors. It contains no Learning or Incident policy,
state, paths, prompts or direct capability dependency. This shared primitive is
necessary because a separately registered observer cannot catch an exception
thrown by another capability's hook. Existing expected policy refusals are omitted.

## Verification

`tests/learning-incidents.test.ts` covers PL-01–09, RI-01–10, bounded retention,
injection/write hygiene, ownership, repair accessibility and revision exclusions.
It executes a real temporary shell check for failure/correction/success and then
calls Verification/Completion with observed fixtures. This proves deterministic
integration, **not** the installed OpenCode event boundary. Native acceptance is
`bun run acceptance`; the driver uses an isolated deterministic model fixture and
real native tools, hooks, discovery and storage. No remote model credentials.

## Reference patterns

Inspected `xiex16070-jpg/dsh-learn` at
`7fbbf5bdc3625e32a63964f708f2fdba946e847a`: `lib/capture.js`,
`lib/sanitize.js`, `lib/extract.js` and README. Adopt bounded source-disciplined
capture, proposal-only detection, failure/recovery pairing, explicit promotion,
normal skills, hygiene at the write path, ownership and bounded audit. No Cordis,
provider internals, curator timers, transcript reader or reference tools are
ported. This is an adaptation of patterns, not a copied subsystem.
