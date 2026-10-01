# Architecture

AndMar AI is a thin deterministic policy and evidence layer over OpenCode V2.
OpenCode owns sessions, tools, permissions, shell, skills, models, VCS and
worktrees. The model decides semantics; deterministic helpers enforce invariants.
There is no Review, workflow engine, parallel plugin framework or UI in core.

## Stable extension surfaces

| Surface | Ownership | Normal extension |
| --- | --- | --- |
| `src/core/` | Config/state adapters, setup, session/model primitives, generic glob/observability, minimal shared read contracts | Frozen for ordinary features; demonstrate multiple real consumers before adding a primitive |
| `src/capabilities/<id>/` | Runtime hooks, state ownership, execution observation, permission/lifecycle boundaries and gates | Modify the owning capability; no sibling imports |
| `assets/skills/<name>/` | Native on-demand procedures | Add/change native SKILL.md and resources, no registry |
| `src/integrations/<name>/` | Optional external adapters | Fail open; no completion authority |
| `scripts/` | Shared deterministic repository tooling | Reuse directly from capabilities; no internal subprocess orchestration |
| Skill `scripts/` | Procedure-exclusive automation | Keep with its native skill |
| `src/generated/` | Capability imports/version/index | Regenerate; never hand edit |
| Native RPC / projections | Read-only presentation contracts | Future plugins/TUI consume existing state; no core reorganization |

A capability exists when skill + script cannot guarantee the required runtime
invariant. Importance alone is insufficient. Work Ledger remains a repository
artifact; lifecycle binds a session and observes it. No Ledger capability or
proprietary storage is introduced. Current inventory is generated in
[CAPABILITIES.md](CAPABILITIES.md); behavior lives in
[ANDMAR-AI-CAPABILITIES.md](ANDMAR-AI-CAPABILITIES.md).

## Core audit and shared contracts

Config/contracts/state/capability setup are cross-capability primitives.
model-policy is shared by routing/delegation; session primitives by delegation
and delivery; glob by impact and portable scope; observability by capabilities
and diagnostics. These remain in core.

`core/task-contract.ts` contains shared read types and the storage-key function
used by Intake and Delivery. Transitions, validation, metrics, projection and
requirement evaluation belong to `capabilities/task-contract/contract.ts`.
Completion evaluation belongs to `capabilities/task-contract/completion.ts`.
Documentation/version impact belongs to `capabilities/lifecycle/impact.ts`.
`core/verification-state.ts` is the actual shared read/evaluation contract consumed
by Verification and Completion. Verification alone writes evidence/receipts.
No procedures or domain orchestration live in core.

Intake owns question/decision policy; its optional provider transport lives in
`integrations/jev/client.ts`. Its provider-specific default is not a concrete
worker model policy. Engram remains optional advisory memory. CodeGraph, CBM,
AiContext, EP and tgrep are optional native navigation consumers in the skill.

## Primary agent and native skills

`assets/agents/andmar.md` owns policy, authority, autonomy and skill selection.
Detailed procedures belong to exactly five native skills: work-ledger,
repo-navigation, git-lifecycle, verification and acceptance. Release stays within
Git lifecycle. The dev installer links the canonical packaged folders into the
installed OpenCode config's native skills directory. The native scanner follows
those links. It refuses to replace foreign/customized installations. No runtime
skill registry, custom discovery or empty future subsystems exist.

Installed V2 format, paths and precedence are documented in
[OPENCODE-V2.md](OPENCODE-V2.md). Skill-specific scripts stay with their skill;
shared Ledger/revision/checkpoint helpers remain in scripts.

## Operational state and progressive context

Work Ledger Markdown is portable, human-readable, versionable repository truth.
`andmar-work.mjs` is its structured machine facade: init, validate, status,
context, record-evidence and existing lifecycle operations. The lifecycle
capability imports the same functions, never spawns this CLI internally.
The state model/parser/validator is shared; there is no second runtime.

Creation assigns IDs from ordered semantic input, validates serialized bytes in
memory and publishes a staged directory atomically. Single-document mutations
validate prospective bytes before atomic rename under the existing Ledger lock.
Evidence replaces a pending placeholder and refuses silent overwrite of real
records. No model EV counter is needed.

Level 0 is compact status; level 1 is active WU context; level 2 related REQ/CON/EV;
level 3 a specific source/section; level 4 an explicitly requested full document.
Routine transitions never inject the full Ledger. No embeddings are needed.

Session binding stores directory/runtime metadata and a compact parsed projection
in memory, not Markdown or ctx.storage. Normal hooks check four cheap file stamps
(inode, size, nanosecond ctime/mtime). Unchanged stamps reuse the projection.
Changed stamps trigger stable-snapshot read/validation; reads retry boundedly if
an external writer races them. Mutations validate and derive responses from
in-memory bytes, without rereading to build the response. The next hook confirms
external/current state when the version changed; this read protects against other
sessions or editors. Unbound trivial work stays on the existing no-IO fast path.

## Invalid state and checkpoints

Invalid Ledger means recovery-required, not an unusable session. Product mutations
and completion fail closed. Native read/search/question, structured validation and
Ledger-only native repair remain available. Refresh after repair without restart.
A different active workId cannot evade the bound checkpoint or recovery state.

A genuine material checkpoint still gates product execution. Native Code Mode
transport can enter; its hooked children are gated independently. These are tool
boundaries, not a universal network sandbox: upstream global fetch remains outside
the tool hooks. Existing guarantees are not broadened to unobserved HTTP.

## Verification and completion

Native shell execution → execute.after evidence → same-session/same-command
receipt → exact-revision Verification → Completion Gate. Process exit/signal/
timeout are observed, not inferred from prose or caller flags. Working-state
fingerprints include HEAD, staged, unstaged and untracked product changes.
Changing state invalidates old receipts. Code Mode ID collisions are retained
as distinct evidence. No caller-declared pass or testsPassed can satisfy the gate.

Work Ledger is durable work truth; Task Contract is a bounded runtime obligation
projection with one-to-one identities. Completion Gate is the only normal
transition to completed. Ledger readiness precedes it; portable finalize follows
with the accepted revision. Git/checkpoint/delivery procedures use native tools;
helpers validate/record but never perform Git mutations.

## Verification evidence and limits

Unit tests validate policy, serialization, recovery and token economy. Native
acceptance must exercise the installed V2 runtime's actual shell/hooks/receipts,
nonzero rejection and stale-revision rejection; mocks cannot establish that
boundary. The acceptance driver uses a deterministic model fixture and real
native execution; it tests runtime contracts, not semantic model quality.
See [TESTING.md](TESTING.md) and [VERIFICATION.md](VERIFICATION.md).

This freezes ownership boundaries, not a promise that future upstream changes
can never require a new primitive. Ordinary features should change one owner or
skill. Optional presentation consumers can use `andmar.work` RPC and structured
status/context without moving core responsibilities.
