---
name: andmar-git-lifecycle
description: Perform authorized native Git delivery, Work Unit checkpoint commits and release operations. Use when the user or repository authorizes a concrete operation.
---

Inspect actual Git state and preserve unrelated work. Use native OpenCode
Git/VCS/provider tools; AndMar helpers never stage, commit, push, merge or publish.
Before each delivery operation call `andmar_delivery` with that named operation.
It reads authoritative user instruction; never invent an authorization boolean.
Proceed on allowed:true and verify external reality afterward. Commit does not
authorize push; push does not authorize PR; PR does not authorize merge; version
does not authorize tag/publish/release. Reconcile uncertain outcomes before retry.

Completed-work operational continuations use Intake's fastPath. Keep the original
contract/Ledger closed and run only checks relevant to the delivery mutation.
A source behavior change instead returns to normal work obligations.

For recoverable WU commits resolve installed helpers from
`${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/plugins/andmar-ai/scripts/`.
After a WU is done/evidenced and the coherent product diff verified, run
`work-unit-checkpoint.mjs prepare <ledger-dir> WU-N --revision <verified-revision>`.
Use ready:true's exact commit message/trailers and paths. With
delivery.workUnitCommits=manual (default), require user/repo commit authority.
auto permits local checkpoint commits only. Perform native staging/commit, then
`work-unit-checkpoint.mjs record <ledger-dir> WU-N --commit <HEAD>` immediately.
No-product-change WUs need no commit. Final integrated verification still applies.

For version/release use current repository SemVer/changelog policy and explicit
targets. Release remains this procedure until a measured need warrants separation.
