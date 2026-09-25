# Capabilities Index

<!-- GENERATED FILE. Run `bun run generate`. Do not edit manually. -->

Objective index derived from `src/capabilities/*/index.ts`.
For purpose, boundaries, state ownership and failure behavior see the canonical
[capabilities guide](ANDMAR-AI-CAPABILITIES.md) and the
[capability contract](CAPABILITY-CONTRACT.md).

| Capability | Version | Description | Tools exposed |
|---|---|---|---|
| `delegation` | 1 | Bounded child-session delegation with model-profile routing and durable handles. | `andmar_delegate`<br>`andmar_resume` |
| `intake` | 2 | Request refinement intake: deterministic-first classification with a single structured Jev decision and explicit fallback. | `andmar_intake`<br>`andmar_intake_trace` |
| `lifecycle` | 2 | Deterministic documentation, versioning and completion gates. | `andmar_change_impact`<br>`andmar_completion_gate` |
| `routing` | 1 | Deterministic minimum-sufficient model profile selection. | `andmar_route` |
| `system` | 1 | Core safety rails, status and lightweight execution journaling. | `andmar_status` |
| `task-contract` | 1 | Persist and update the active Task Contract: goal, requirements, constraints and requirement evidence. | `andmar_task_contract`<br>`andmar_request_review` |
| `verification` | 3 | Revision-bound verification receipts resolved internally from observed OpenCode execution evidence. | `andmar_record_receipt`<br>`andmar_verify_revision`<br>`andmar_suggest_checks` |

_Source of truth for registration: `src/generated/capabilities.ts`._
