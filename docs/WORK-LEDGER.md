# Work Ledger

The Ledger is repository-native durable operational truth under
`.andmar/work/<work-id>/`. Lightweight work uses WORK.md; structured work uses
SOURCE.md, REQUIREMENTS.md, WORK.md and EVIDENCE.md. It travels across sessions,
machines and agents. This self-hosted repository ignores its own `.andmar/`;
consumer repositories retain their own portability policy.

Markdown is durable representation. The structured facade is the machine API.
Normal execution must not repeatedly read/edit the full documents.

## Surfaces

| Surface | Purpose |
| --- | --- |
| `andmar_work` | Semantic creation, validate, record-evidence, activate, complete, block, reopen, touch |
| `andmar_work_status` | Bind an existing Ledger, refresh, query compact progress/recovery |
| `andmar_work_context` | Active/specific WU, REQ, CON, EV or document section |
| `andmar_work_amend` | Necessary discovered WU under current REQs; explicit facts decide material checkpoint |
| `andmar_work_resume` | Runtime resolution after the user's actual checkpoint response |
| `scripts/andmar-work.mjs` | Same logic for native shell/CLI consumers: init, validate, status, context, record-evidence, activate, complete, block, resume, reopen, amend, touch, finalize |
| `scripts/work-unit-checkpoint.mjs` | Exact-revision readiness and recording native Git checkpoint results |

Runtime access belongs to lifecycle because it needs binding/hooks. There is no
Work Ledger capability or Markdown mirror in ctx.storage. Lifecycle imports the
helpers directly. CLI commands are trusted offline/native operator tooling,
not shell workarounds for a paused runtime.

## Semantic creation contract

`init` accepts an object with `goal`, optional `title`, `mode`, `requirements`
(array of texts), optional `constraints` (array of texts), and `units`. A unit
contains `title`, `requirements` (explicit REQ IDs), `acceptance`, optional
`constraints` (CON IDs) and optional `expectedFiles` (workspace-relative paths/
globs). Structured mode also requires `source`. Preserve all real obligations;
redact literal credentials. Source is quoted to prevent user Markdown headings
from accidentally becoming structural declarations.

The serializer assigns REQ-N, CON-N and WU-N in input order, checks references,
validates bytes before writing and stages all initial documents for one directory
rename. It refuses overwrite of existing work. No partial valid Ledger is exposed
on a failed creation. No agent-managed counter or hand-written template is needed.

Example payload:

```json
{
  "goal": "Make the CLI return correct JSON",
  "mode": "structured",
  "source": "Fix the JSON flag while preserving normal output.",
  "requirements": ["Return valid JSON for --json", "Preserve normal output"],
  "constraints": ["No new dependency"],
  "units": [{
    "title": "Correct and verify CLI output",
    "requirements": ["REQ-1", "REQ-2"],
    "constraints": ["CON-1"],
    "acceptance": "Exercise both CLI output modes",
    "expectedFiles": ["src/**", "tests/**"]
  }]
}
```

The CLI accepts `<operation> <ledger-dir> [JSON payload or @payload.json]` and
returns JSON, with a nonzero exit on refusal/invalid validation. Resolve installed
helpers from `${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/plugins/andmar-ai`,
never from the consumer project's scripts directory. Agent procedures belong in
[andmar-work-ledger](../assets/skills/andmar-work-ledger/SKILL.md), not this API
contract or the primary agent.

## Evidence and transitions

Evidence input is `{description}` or `{id,description}` to fill a known placeholder.
Allocate IDs centrally while holding the shared cross-process lock. Replace
`Pending ...` declarations once. Reject an existing real EV; never append another
heading with the same ID. Validate unicity before atomic write. Evidence is a
compact claim/pointer, not copied logs. Portable EV does not substitute runtime
Verification proof.

Existing lifecycle rules remain: only one active WU, valid states pending/active/
done/blocked, complete requires declared nonpending evidence and activates the
next pending WU; reopen clears evidence/checkpoint pointers. Complete/finalize
cannot silently discard obligations. Finalize requires all WUs done and the
accepted revision. Completed Ledgers are immutable through normal helpers.

Single-document writes validate prospective bytes in memory before atomic rename.
All cooperating native CLI/runtime mutations share the Ledger lock. A stale lock
is diagnosed, never silently stolen. Noncooperating editors are detected at the
next hook/read by a cheap file stamp; bounded stable-snapshot reads prevent cached
state from masking an external change. Helpers derive mutation responses from
in-memory state instead of rereading simply to construct JSON.

## Progressive context contract

`status` returns workId/status/active/pending/done/blocked/completionReady/
checkpointRequired/checkpointAt/blockedReason. Lists contain IDs, not histories.
Runtime status additionally includes active scope/current activity/tracking error
and counts for presentation. Neither includes completed unit bodies or Markdown.

`context({})` returns the active (or blocked) WU, minimum global goal, related
requirements/constraints, acceptance, expected/touched files, drift, related
attached evidence, blocker/checkpoint and Next. It omits unrelated WUs, unrelated
REQs and all source/history. Constraints without a per-unit mapping are treated
as global; they cannot be silently dropped.

Selectors `unit`, `requirement`, `constraint`, `evidence` retrieve exact IDs.
`document` with `section` expands only that section. `document` alone explicitly
requests exceptional full content. Defaults never inject all documents.

Restart rebinds the same workId and queries the active projection. Missing Task
Contract is reconstructed by targeted obligation queries with 1:1 identities;
completed outcomes are not redone without invalidating evidence.

## Recovery and material checkpoints

Malformed IDs, WU states or dangling references mark a binding invalid/
recovery-required. Diagnostics are structured; continuation/product mutation and
completion fail closed. Native read/search/question remain available. Native
write/edit may target only the four Ledger documents for repair; arbitrary shell
and product edits stay refused. Validate and refresh after repair, without restart.

A material exception records durable blocker, Checkpoint At and optional user ID.
User response must follow that temporal boundary; status questions do not consent.
Resume compares the exact boundary under lock. A different Ledger cannot evade an
unfinished binding. Native Code Mode transport is allowed so hooked recovery tools
can run; child product tools remain gated. Upstream unhooked global HTTP is outside
this guarantee, as documented in [OPENCODE-V2.md](OPENCODE-V2.md).

## Ownership and consumers

Native hooks record observed touched paths; scope drift is advisory unless explicit
exception facts require checkpoint. VCS/output coverage gaps are visible, never
parsed from prose. Optional read-only `andmar.work` RPC exposes derived status and
changed events; RPC failure is isolated. Presentation plugins/CLI/TUI can consume
these contracts without becoming core or controlling work truth.

Completion follows portable readiness, runtime Completion Gate, then finalize.
Checkpoint commit helpers prepare/record; native OpenCode executes Git. Delivery
policy remains separate. Details live in the verification and Git lifecycle skills.

Regression coverage: semantic init/no partial publication, parallel EV allocation,
EV-8 placeholder replacement, refusal of real overwrite, compact status, related
active context, cached unchanged versions, restart projection, corrupt Ledger
recovery, and existing checkpoint temporal/permission boundaries.
