# Work Ledger

**Scope:** canonical specification for repository-native durable operational state in AndMar AI.

## 1. Architectural thesis and purpose

Work Ledger provides a durable, portable, and human-readable representation of work in the repository. It enables:

- resuming execution cleanly after context compaction;
- continuing work from a new session;
- continuing work from another machine via Git;
- switching coding agents or models mid-task;
- avoiding repetition of already finished work units;
- preserving explicit requirements and constraints across sessions;
- tracking the immediate next unit of work (`Next`);
- indexing evidence references without context bloat;
- preparing future commits by work unit.

Work Ledger is **portable repository state**. It is **not**:
- `ctx.storage` state;
- a workflow engine;
- a planner;
- a memory system;
- a runtime capability.

## 2. Capability vs repository artifact (D-027, D-028)

AndMar AI defines a capability as a *runtime guarantee requiring state, hooks, ownership, or gates*.

In AndMar AI, Work Ledger is deliberately **not** a capability:
- It uses repository-native durable markdown files under `.andmar/work/<work-id>/`.
- It is read and written using OpenCode native tools (`read`, `write`, `edit`).
- It does not introduce new `ctx.storage` keys or bypass OpenCode permission systems.
- It travels with Git, remaining visible and portable across machines, branches, and agents.
- **Operational metadata:** `.andmar/work/**` is operational metadata and is strictly excluded from the working-state revision fingerprint used to bind code/product verification evidence.

## 3. Relationship with Task Contract

Work Ledger and Task Contract have distinct, complementary roles:

```text
SOURCE / REQUIREMENTS (User Request + Repo Context)
       ↓
Work Ledger (Portable continuity source in repository: .andmar/work/)
       ↓
Task Contract (Bounded runtime completion projection in ctx.storage)
```

| Dimension | Work Ledger (`.andmar/work/<work-id>/`) | Task Contract (`ctx.storage`) |
|---|---|---|
| **Primary purpose** | Durable, portable continuity across sessions/machines | Bounded runtime execution gate and receipt binding |
| **Storage medium** | Repository files in Markdown | Plugin key-value storage (`task-contract/<sessionID>`) |
| **Requirements mapping** | Source of atomic obligations (`REQ-1`, `REQ-2`...) | Strict **1:1 mapping** up to `MAX_REQUIREMENTS = 100` |
| **Lifecycle** | Persists with the repository / branch | Bounded to session runtime, seals on completion |
| **Evidence role** | Portable index of check results and pointers | Cryptographically bound to exact working-state revisions |
| **Gate authority** | None (no independent completion gate) | Authoritative runtime gate for `andmar_completion_gate` |

### One-to-one requirement mapping (no grouping)

The Task Contract provides runtime capacity for up to **100 requirements** (`MAX_REQUIREMENTS = 100`).
- Every requirement in the Work Ledger maps 1:1 to a requirement in the Task Contract:
  ```text
  Ledger REQ-1 → Contract REQ-1
  Ledger REQ-2 → Contract REQ-2
  ...
  Ledger REQ-N → Contract REQ-N
  ```
- **No grouping:** Independent user obligations are never grouped or merged into artificial parent requirements.
- **Capacity boundary (>100):** If a specification exceeds 100 requirements, the Work Ledger preserves all obligations losslessly, while the Task Contract rejects the bounded projection with an explicit limitation error (`requirements is limited to 100 real obligations`). It does not truncate, group, or falsely claim formal completion.

### Reconciliation rule

When discrepancies exist:
1. Recover the current raw user request if available in the session.
2. Read the Work Ledger files to reconcile portable truth.
3. Update or steer the Task Contract to match.
4. Continue execution.

Contradictions must never be resolved silently by model preference.

## 4. Location and `work-id`

Work Ledger artifacts reside under:

```text
.andmar/work/<work-id>/
```

- **`work-id`**: Short, human-readable, path-safe slug derived from the goal (e.g. `fix-review-timeout`, `add-file-line-routing`, `auth-refresh-flow`). UUIDs and global registries are avoided. If a collision occurs with a different active work item, append a concise suffix (e.g. `auth-refresh-flow-2`).
- **Git tracking**: `.andmar/work/**` is not ignored by default. It travels with Git unless project-specific policies dictate otherwise.
- **Harness execution**: The `andmar-ai` development repo does not commit execution data under `.andmar/work/`. The convention applies to projects where AndMar operates.

## 5. Work Projection from Intake

Intake determines the initial work projection mode via `workProjection.mode`:

### `mode: none` (Trivial / Direct)
- Applied to direct, single-step tasks (e.g., cosmetic tweaks, single typo fixes).
- No Ledger files are created by default.
- If execution reveals that the task requires multiple work units or durable continuity, the agent autonomously promotes the task to `lightweight` without interrupting the user.

### `mode: lightweight` (Enrich / Intermediate)
- Applied to tasks requiring modest context enrichment or a short sequence of outcomes.
- Creates only a single file:
  ```text
  .andmar/work/<work-id>/WORK.md
  ```
- Does not create `SOURCE.md`, `REQUIREMENTS.md`, or `EVIDENCE.md` while the task remains lightweight.

### `mode: structured` (Structure / Multi-part)
- Applied to complex requests, multi-requirement PRDs, architectural migrations, or requests exceeding 8,000 characters.
- Creates the complete ledger structure:
  ```text
  .andmar/work/<work-id>/
  ├── SOURCE.md
  ├── REQUIREMENTS.md
  ├── WORK.md
  └── EVIDENCE.md
  ```

## 6. Artifact schemas and specifications

### 6.1 Identifiers

Standard identifiers across all ledger files:
- Requirements: `REQ-1`, `REQ-2`, ...
- Constraints: `CON-1`, `CON-2`, ...
- Work Units: `WU-1`, `WU-2`, ... (or `W1`, `W2`, ...)
- Evidence Pointers: `EV-1`, `EV-2`, ...

Never recycle or reassign previously deleted IDs.

### 6.2 Lightweight `WORK.md`

```md
# Work — <title>

Work ID: <work-id>
Status: active
Mode: lightweight

## Goal

<one clear outcome>

## Source

- current user request

## Constraints

- CON-1: <constraint 1>

## Requirements

- REQ-1: <short requirement description>
- REQ-2: <short requirement description>

## Work Units

- [~] WU-1 — <coherent outcome>
  - Requirements: REQ-1
- [ ] WU-2 — <coherent outcome>
  - Requirements: REQ-2

## Evidence

- EV-1: <small pointers to tests or runtime smoke>

## Decisions

- <recorded technical decisions if any>

## Next

WU-1 — <next concrete outcome>
```

### 6.3 Structured `SOURCE.md`

`SOURCE.md` preserves the authoritative intent and obligations without transcript noise.

**Preservation rules (lossless regarding obligations):**
- Retain all requirements, exceptions, boundary conditions, compatibility constraints, acceptance criteria, and explicitly requested actions.
- Omit conversational filler, social exchanges, and redundant prose.
- **Secret redaction rule:** Never persist literal API keys, passwords, bearer tokens, cookies, or secrets. Redact literal secrets using `[REDACTED_SECRET]` while preserving the operational obligation (e.g., *"Authenticate using [REDACTED_SECRET] provided in the session environment"*).
- Do not store model chain-of-thought or raw transcripts.
- If the authoritative specification already exists as a versioned repository file, prefer referencing its path rather than duplicating its contents.

```md
# Source

## Provenance

- Source: current user request
- Additional explicit repository sources:
  - <path if applicable>

## Authoritative intent

<lossless representation of intent>

## Explicit requirements and constraints

<enumerated explicit obligations>

## Explicit acceptance / verification expectations

<verification criteria specified by user or repo>

## Unresolved decisions

<unresolved product questions if any>
```

### 6.4 Structured `REQUIREMENTS.md`

`REQUIREMENTS.md` records all atomic obligations with stable IDs (`REQ-1`, `REQ-2`, etc.) and subrequirements (`REQ-1.1`, `REQ-1.2`).

```md
# Requirements

## REQ-1 — <short title>

Status: pending

Requirement:
<clear statement of obligation>

Acceptance:
- <verifiable acceptance criterion 1>
- <verifiable acceptance criterion 2>

Source:
- user request

---

## REQ-2 — <short title>
...
```

### 6.5 Structured `WORK.md`

`WORK.md` represents the active execution state and daily operational view.

```md
# Work — <title>

Work ID: <work-id>
Status: active
Mode: structured

## Goal

<high-level outcome>

## Constraints

- CON-1: <constraint>

## Work Units

- [x] WU-1 — <completed outcome>
  - Requirements: REQ-1
  - Evidence: EV-1
- [~] WU-2 — <active outcome>
  - Requirements: REQ-2
- [ ] WU-3 — <pending outcome>

## Blockers

None.

## Next

WU-2 — <single next concrete outcome>
```

**Work Unit states:**
- `[ ]` pending
- `[~]` active (at most **one** active unit per ledger)
- `[x]` done (requires proportional evidence recorded in ledger)
- `[!]` blocked (requires an explicit explanatory reason)

**Work Unit rules:**
- Units represent recoverable, verifiable outcomes (e.g. `Add target parser`, `Integrate routing table`), not trivial microsteps (`rename variable`, `run linter`).
- If an active unit turns out to be larger than anticipated, it may be subdivided or new units appended (`WU-4 added for newly discovered outcome`). Avoid renumbering units already referenced by evidence.

### 6.6 Structured `EVIDENCE.md`

`EVIDENCE.md` stores an index of pointers to verification results.

```md
# Evidence

## EV-1

Work unit: WU-1
Requirements: REQ-1
Type: verification
Revision: <working-state revision if applicable>
Reference: `node --test tests/unit.test.ts`
Result: passed

## EV-2

Work unit: WU-1
Type: runtime
Reference: <short description of runtime verification>
Result: passed
```

Do not store full stdout, massive test logs, or code diffs in `EVIDENCE.md`. Formal revision-bound receipts remain in `verification` capability state.

## 7. Operational lifecycle and agent policy

### 7.1 Progressive context retrieval on resume

When resuming a session or recovering after context compaction:
1. Look for `.andmar/work/*/WORK.md` only when the user asks to resume, the request appears to be a continuation, or an active work path is already known.
2. Read `WORK.md` first to identify `Goal`, active unit, and `Next`.
3. Read `REQUIREMENTS.md` only for requirements mapped to `Next`.
4. Read `SOURCE.md` only if intent ambiguity arises.
5. Read `EVIDENCE.md` when confirming completion or preparing the final gate.

### 7.2 Reconstruction of Task Contract

If a session restarts on a new machine or after session reset where `.andmar/work/<work-id>/` is present but `andmar_task_contract(op=status)` returns `active: false`:
1. Read Goal, requirements, and constraints from the Work Ledger.
2. Reconstruct the runtime Task Contract using `andmar_task_contract(op=create)`.
3. Preserve the existing `taskKind`.
4. Continue execution from `Next` without redoing completed work units `[x]`.

### 7.3 Priority hierarchy

```text
Current explicit user instruction
       >
Work Ledger (.andmar/work/)
       >
Current repository state
       >
Task Contract runtime projection (ctx.storage)
       >
Model memory / assumptions
```

Model memory never overrides repository files or the Work Ledger.

### 7.4 Update cadence (churn prevention) and validation

Work Ledger files must **not** be modified on every tool call. Updates are made only upon significant operational events:
- Work item initialized;
- New work unit started (`[~]`);
- Work unit completed (`[x]`);
- Blocker encountered (`[!]`);
- User steers the task;
- Plan of outcomes materially changes;
- Key verification evidence is recorded;
- Task completion is being prepared.

Run deterministic structure validation with `node "${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/plugins/andmar-ai/scripts/validate-work-ledger.mjs" .andmar/work/<work-id>` after initialization, requirement-modifying steering, material Work Unit list changes, or completion preparation. Deterministic lifecycle transitions validate atomically before and after mutation, so do not rerun the validator mechanically after each lifecycle command.

**Runtime helper location:** AndMar helpers live under the installed plugin root `${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/plugins/andmar-ai`. Commands must resolve helpers there rather than assuming the consumer repository has an AndMar `scripts/` directory.

### 7.5 Deterministic Work Unit lifecycle

Normal Work Unit state transitions are performed with the installed deterministic helper rather than by hand-editing markers:

```text
${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/plugins/andmar-ai/scripts/work-ledger-lifecycle.mjs
```

Supported commands:

```text
status <ledger-dir>
activate <ledger-dir> WU-N
complete <ledger-dir> WU-N --evidence EV-N[,EV-N] [--next WU-N]
block <ledger-dir> WU-N --reason "..."
resume <ledger-dir> WU-N --reason "..."
reopen <ledger-dir> WU-N --reason "..."
```

Transition contract:

```text
pending  --activate--> active
active   --complete + evidence--> done
active   --block + reason--> blocked
blocked  --resume + resolution reason--> active
done     --reopen + reason--> active
```

Rules:
- At most one Work Unit is active.
- `complete` requires at least one already-declared `EV-N`; it refuses unknown evidence.
- `complete` atomically promotes the next pending unit in file order, or an explicitly selected pending unit via `--next`. When none remain, no Work Unit is active and `Next` points to final verification.
- `block` records the reason and moves the ledger to `Status: blocked`.
- `resume` removes the active blocker field and records why work can continue.
- `reopen` is explicit and only valid for a done unit whose outcome/evidence became invalid; it removes that unit's current evidence pointer before returning it to active. Historical evidence may remain in the evidence index, but it is no longer attached as proof of the reopened unit.
- A ledger already marked `Status: completed` is immutable to Work Unit lifecycle commands. Post-completion operational continuations use the existing Intake fast-path instead of reopening the Ledger.
- Every mutation validates the Ledger before and after writing. A post-mutation validation failure rolls the `WORK.md` mutation back.
- The helper only mutates `.andmar/work/<work-id>/WORK.md`; it does not run tests, create evidence, modify source code, call Task Contract tools, commit Git state, or decide semantics. OpenCode remains the executor.

Use native OpenCode edits for initialization, requirements, evidence content, steering, and material Work Unit list changes. Use the lifecycle helper for state transitions.

### 7.6 Work Unit checkpoints

Git checkpoints reduce recovery cost, but Git execution remains native OpenCode behavior. AndMar adds only deterministic readiness/recording around a Work Unit commit. It does not add a Git capability or Delivery subsystem.

Installed helper:

```text
${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/plugins/andmar-ai/scripts/work-unit-checkpoint.mjs
```

Two-phase flow:

```text
WU done + Evidence
→ focused verification on exact working-state revision
→ checkpoint prepare (read-only)
→ native OpenCode Git commit
→ checkpoint record (stores SHA in WORK.md)
```

Prepare:

```text
node ".../work-unit-checkpoint.mjs" prepare .andmar/work/<work-id> WU-N --revision <verified-working-state-revision>
```

`prepare` requires the Work Unit to be `[x]`, to reference `EV-N` evidence, to have no existing checkpoint, to have no Git conflicts, and to match the exact current working-state revision. It returns the coherent product paths currently changed (excluding `.andmar/work/**`) plus an exact commit message containing:

```text
Work-ID: <work-id>
Work-Unit: WU-N
Verified-Revision: <sha256 working-state revision>
```

If no product files changed outside `.andmar/work/**`, it returns `ready:false` with `reason=no-product-changes`; a metadata-only Work Unit does not need a checkpoint commit.

OpenCode then performs staging/commit using native Git according to project/user authorization. `delivery.workUnitCommits` is `manual` by default; `auto` authorizes only this local checkpoint commit after `prepare` returns `ready:true`. It never authorizes push, PR, merge, tag, publish, or release.

Record:

```text
node ".../work-unit-checkpoint.mjs" record .andmar/work/<work-id> WU-N --commit <HEAD>
```

`record` requires the commit to be current `HEAD`, verifies the three trailers above, requires at least one product path outside `.andmar/work/**`, and writes:

```text
Checkpoint: <full commit sha>
```

The validator accepts `Checkpoint: none` or a Git commit hash only. A non-done Work Unit cannot retain a checkpoint, and the same checkpoint SHA cannot be assigned to multiple Work Units. Reopening a done Work Unit clears both its current `Evidence` and `Checkpoint` pointers because both are stale for the reopened outcome.

Checkpoint commits are deliberately per coherent Work Unit: behavior, directly associated tests, and directly associated local documentation may travel together. Do not combine unrelated cleanup or another Work Unit. No independent review is required per checkpoint; final integrated verification and normal final review/completion policy still apply.

### 7.7 User steering

When the user provides new instructions during execution:
1. Determine whether the instruction extends or replaces the goal.
2. If it extends the task:
   - Update `REQUIREMENTS.md` / `WORK.md` first.
   - Adjust work units and constraints.
   - Steer the runtime contract with `andmar_task_contract(op=steer)`.
3. Never delete existing requirements unless explicitly superseded or cancelled by the user.

### 7.8 Completion integration

Work Ledger does **not** create a new completion tool or gate. Final verification and closure proceed strictly through existing primitives:
1. Reconcile `WORK.md` (all required units `[x]`, none `[~]`).
2. Verify that Task Contract requirements reflect Ledger obligations 1:1.
3. Record exact-revision requirement evidence with `andmar_task_contract(op=record_evidence)`.
4. Run verification and `andmar_verify_revision`.
5. Run review with `andmar_request_review`.
6. Seal completion with `andmar_completion_gate`.
7. After the gate succeeds and the Task Contract is closed as completed, update the Ledger metadata to `Status: completed`; this metadata-only write does not change the code/product revision fingerprint.

## 8. No hidden context

Every durable assertion in the Work Ledger must be traceable to:
- the current user request;
- the repository state;
- the Work Ledger itself; or
- an explicitly available upstream source.

Do not record untraceable assertions such as *"per earlier discussion"* without an accessible source.
