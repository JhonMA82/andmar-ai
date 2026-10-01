# Capabilities Index

<!-- GENERATED FILE. Run `bun run generate`. Do not edit manually. -->

Objective index derived from capability declarations and local tool registrations.
For purpose, boundaries, state ownership and failure behavior see the canonical
[capabilities guide](ANDMAR-AI-CAPABILITIES.md) and the
[capability contract](CAPABILITY-CONTRACT.md).

| Capability | Version | Description | Tools exposed |
|---|---|---|---|
| `delegation` | 1 | Bounded child-session delegation with model-profile routing and durable handles. | `andmar_delegate`<br>`andmar_resume` |
| `delivery` | 1 | Gate delivery intent with traceable user authorization and completion readiness while leaving Git, PR, publish and release execution to native OpenCode tools. | `andmar_delivery` |
| `development-metrics` | 1 | Bounded local metrics for AndMar intervention, friction, value and recovery during development. | `andmar_report` |
| `intake` | 2 | Request refinement intake: deterministic-first classification into direct, enrich, or structure with a single structured Jev decision and explicit fallback. | `andmar_intake`<br>`andmar_intake_trace` |
| `lifecycle` | 5 | Deterministic documentation/version impact and portable Work Unit tracking. | `andmar_change_impact`<br>`andmar_work_status`<br>`andmar_work_context`<br>`andmar_work`<br>`andmar_work_amend`<br>`andmar_work_resume` |
| `routing` | 1 | Deterministic minimum-sufficient model profile selection. | `andmar_route` |
| `system` | 1 | Core safety rails, status and lightweight execution journaling. | `andmar_status` |
| `task-contract` | 4 | Persist Task Contract obligations and enforce the evidence-derived completion boundary. | `andmar_task_contract`<br>`andmar_completion_gate` |
| `verification` | 5 | Revision-bound verification receipts resolved internally from observed OpenCode execution evidence, including the observed process outcome (exit code, signal, timeout). | `andmar_record_receipt`<br>`andmar_verify_revision`<br>`andmar_suggest_checks` |

_Source of truth for registration: `src/generated/capabilities.ts`._
