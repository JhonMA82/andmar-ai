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

Work Ledger is **not** a workflow engine, a mandatory planner, a DAG scheduler, general semantic memory, or a second runtime. It does not replace the Task Contract or completion gates.

## 2. Capability vs repository artifact (D-027)

AndMar AI defines a capability as a *runtime guarantee requiring state, hooks, ownership, or gates*.

In version 0.8.2, Work Ledger is deliberately **not** a capability:
- It uses repository-native durable markdown files under `.andmar/work/<work-id>/`.
- It is read and written using OpenCode native tools (`read`, `write`, `edit`).
- It does not introduce new `ctx.storage` keys or bypass OpenCode permission systems.
- It travels with Git, remaining visible and portable across machines, branches, and agents.

If demonstrated runtime friction or synchronization defects emerge that cannot be governed by agent policy and existing gates, a narrow runtime capability may be evaluated in future versions. It is not created preventively.

## 3. Relationship with Task Contract

Work Ledger and Task Contract have distinct, complementary roles:

```text
SOURCE / REQUIREMENTS (User Request + Repo Context)
       ↓
Work Ledger (Portable continuity source in repository)
       ↓
Task Contract (Bounded runtime completion projection in ctx.storage)
```

| Dimension | Work Ledger (`.andmar/work/<work-id>/`) | Task Contract (`ctx.storage`) |
|---|---|---|
| **Primary purpose** | Durable, portable continuity across sessions/machines | Bounded runtime execution gate and receipt binding |
| **Storage medium** | Repository files in Markdown | Plugin key-value storage (`task-contract/<sessionID>`) |
| **Requirements scope** | All atomic obligations (unbounded, structured/subrequirements) | Bounded projection (max 20 parent requirement groups) |
| **Lifecycle** | Persists with the repository / branch | Bounded to session runtime, seals on completion |
| **Evidence role** | Portable index of check results and pointers | Cryptographically bound to exact working-state revisions |
| **Gate authority** | None (no independent completion gate) | Authoritative runtime gate for `andmar_completion_gate` |

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

### 6.1 Lightweight `WORK.md`

```md
# Work — <title>

Work ID: <work-id>
Status: active
Task kind: <taskKind>
Intake mode: <mode>

## Goal

<one clear outcome>

## Constraints

- <constraint 1>

## Requirements

- REQ-01 — <short requirement description>
- REQ-02 — <short requirement description>

## Work Units

- [~] W1 — <coherent outcome>
- [ ] W2 — <coherent outcome>

## Evidence

- <small pointers to tests or runtime smoke>

## Next

W1 — <next concrete outcome>
```

### 6.2 Structured `SOURCE.md`

`SOURCE.md` preserves the authoritative intent and obligations without transcript noise.

**Preservation rules (lossless regarding obligations):**
- Retain all requirements, exceptions, boundary conditions, compatibility constraints, acceptance criteria, and explicitly requested actions.
- Omit conversational filler, social exchanges, and redundant prose.
- **Secret redaction rule:** Never persist literal API keys, passwords, bearer tokens, cookies, or secrets. Redact literal secrets while preserving the operational obligation (e.g., *"Authenticate using the provided API token from the secure environment"*).
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

### 6.3 Structured `REQUIREMENTS.md`

`REQUIREMENTS.md` records all atomic obligations with stable IDs (`REQ-01`, `REQ-02`, etc.) and subrequirements (`REQ-01.1`, `REQ-01.2`).

```md
# Requirements

## REQ-01 — <short title>

Status: pending

Requirement:
<clear statement of obligation>

Acceptance:
- <verifiable acceptance criterion 1>
- <verifiable acceptance criterion 2>

Source:
- user request

### Subrequirements

- REQ-01.1 — <atomic subrequirement>
- REQ-01.2 — <atomic subrequirement>

---

## REQ-02 — <short title>
...
```

**Handling > 20 Requirements:**
The runtime Task Contract is strictly bounded to at most 20 requirements. When `REQUIREMENTS.md` exceeds 20 atomic obligations:
1. Retain **all** atomic obligations in `REQUIREMENTS.md`.
2. Group related atomic obligations into at most 20 coherent parent requirements (`REQ-01` to `REQ-20`).
3. Project these parent requirements to the Task Contract.
4. Maintain the atomic subrequirements under each parent.
5. A parent requirement cannot be marked satisfied until all its subrequirements are verified.

### 6.4 Structured `WORK.md`

`WORK.md` represents the active execution state and daily operational view.

```md
# Work — <title>

Work ID: <work-id>
Status: active
Task kind: <taskKind>
Intake mode: structure

## Goal

<high-level outcome>

## Constraints

- CON-01 — <constraint>

## Work Units

- [x] W1 — <completed outcome>
  - Requirements: REQ-01, REQ-02.1
  - Evidence: EV-001, EV-002
- [~] W2 — <active outcome>
  - Requirements: REQ-03
- [ ] W3 — <pending outcome>

## Blockers

None.

## Next

W2 — <single next concrete outcome>
```

**Work Unit states:**
- `[ ]` pending
- `[~]` active (at most **one** active unit per ledger)
- `[x]` done (requires proportional evidence recorded in ledger)
- `[!]` blocked (requires an explicit explanatory reason)

**Work Unit rules:**
- Units represent recoverable, verifiable outcomes (e.g. `Add target parser`, `Integrate routing table`), not trivial microsteps (`rename variable`, `run linter`).
- If an active unit turns out to be larger than anticipated, it may be subdivided or new units appended (`W4 added for newly discovered outcome`). Avoid renumbering units already referenced by evidence.

### 6.5 Structured `EVIDENCE.md`

`EVIDENCE.md` stores an index of pointers to verification results.

```md
# Evidence

## EV-001

Work unit: W1
Requirements: REQ-01, REQ-02.1
Type: verification
Revision: <working-state revision if applicable>
Reference: `bun test tests/unit.test.ts`
Result: passed

## EV-002

Work unit: W1
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
       ↓
Portable Work Ledger (.andmar/work/)
       ↓
Current repository state
       ↓
Task Contract runtime projection (ctx.storage)
       ↓
Model memory / assumptions
```

Model memory never overrides repository files or the Work Ledger.

### 7.4 Update cadence (churn prevention)

Work Ledger files must **not** be modified on every tool call. Updates are made only upon significant operational events:
- Work item initialized;
- New work unit started (`[~]`);
- Work unit completed (`[x]`);
- Blocker encountered (`[!]`);
- User steers the task;
- Plan of outcomes materially changes;
- Key verification evidence is recorded;
- Task completion is being prepared.

### 7.5 User steering

When the user provides new instructions during execution:
1. Determine whether the instruction extends or replaces the goal.
2. If it extends the task:
   - Update `REQUIREMENTS.md` / `WORK.md` first.
   - Adjust work units and constraints.
   - Steer the runtime contract with `andmar_task_contract(op=steer)`.
3. Never delete existing requirements unless explicitly superseded or cancelled by the user.

### 7.6 Completion integration

Work Ledger does **not** create a new completion tool or gate. Final verification and closure proceed strictly through existing primitives:
1. Reconcile `WORK.md` (all required units `[x]`, none `[~]`).
2. Verify that Task Contract requirements reflect Ledger obligations.
3. Record exact-revision requirement evidence with `andmar_task_contract(op=record_evidence)`.
4. Run verification and `andmar_verify_revision`.
5. Run review with `andmar_request_review`.
6. Seal completion with `andmar_completion_gate`.

## 8. No hidden context

Every durable assertion in the Work Ledger must be traceable to:
- the current user request;
- the repository state;
- the Work Ledger itself; or
- an explicitly available upstream source.

Do not record untraceable assertions such as *"per earlier discussion"* without an accessible source.
