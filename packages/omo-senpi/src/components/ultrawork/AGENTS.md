# ultrawork component

## OVERVIEW

Input classification and session-scoped arming for the ultrawork directive. This component owns the shared arming ledger consumed by the todo fanout reminder; it does not execute plans or deliver continuations.

## WHERE TO LOOK

| Path | Role |
|------|------|
| `index.ts` | Component registration, input classification, session arming, compaction lifecycle, and exported testable helpers. |
| `generated-directive.ts` | Packaged directive text; keep the exact payload aligned with the generated source. |
| `ultrawork.test.ts` | Classification, routing, hidden-message, and lifecycle behavior. |
| `ultrawork-arming.test.ts` | Shared ledger and re-registration behavior. |
| `ultrawork.test-support.ts` | Isolated arming and fake host helpers. |

## CONVENTIONS

- The process-lifetime arming ledger is stored in a `globalThis` slot keyed by `Symbol.for`; extension re-registration must reuse it instead of resetting session state.
- Tests pass an isolated `SessionArming` instance when they need deterministic state. Production uses `sharedSessionArming()`.
- Classification strips quoted or injected regions before recognizing complete-word `ulw` or `ultrawork`, then records route, invocation stage, and suppression reason separately.
- Input handling distinguishes direct user input from extension-sourced input. Queued inputs append the directive atomically; idle inputs use the hidden custom-message path.
- Accepted compaction can re-arm a session; rejected compaction must not. Session switches clear only the affected session's state.

## ANTI-PATTERNS

- Do not use substring matching for the directive or accept a directive embedded in quoted content.
- Do not let extension-sourced input arm the session, duplicate an already embedded directive, or bypass suppression reasons.
- Do not put the ledger in module-local state or inside `register`; uncached extension loading would lose arming state.
- Do not make todo-reminder or continuation delivery responsible for classification; those components consume this contract.
