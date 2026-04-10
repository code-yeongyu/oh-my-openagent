# src/hooks/runtime-fallback/ — Runtime Model Fallback Hook

## OVERVIEW

This subtree implements the runtime fallback hook that reacts to provider/runtime failures and retries a session on alternative models. It is stateful, event-driven, and tightly coupled to session lifecycle, error classification, fallback-model resolution, and retry dispatch.

## STRUCTURE

```text
runtime-fallback/
├── hook.ts                    # createRuntimeFallbackHook()
├── event-handler.ts           # session.created/error/idle/stop/status flow
├── message-update-handler.ts  # message.updated retry signals
├── chat-message-handler.ts    # chat.message coordination
├── error-classifier.ts        # status codes, quota/model/api-key classification
├── fallback-models.ts         # candidate fallback model selection
├── fallback-retry-dispatcher.ts
├── session-status-handler.ts
├── fallback-state.ts
└── constants.ts / types.ts
```

## KEY INVARIANTS

- Fallback is gated by explicit config and retryable error classification.
- Session-scoped state maps must stay internally consistent on create, stop, idle, error, and delete events.
- Aborted/cancelled sessions must clear retry state instead of silently rearming retries.
- `error-classifier.ts` is the contract for what is retryable; do not scatter ad hoc retry logic elsewhere.
- Keep bootstrap-model resolution and fallback-model selection deterministic and debuggable.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Hook wiring and lifecycle cleanup | `hook.ts` | owns interval/timer/session-state setup |
| Event-driven retry behavior | `event-handler.ts` | most of the operational logic lives here |
| Error interpretation | `error-classifier.ts` | API key, quota, status-code, model-not-found cases |
| Retry dispatch | `fallback-retry-dispatcher.ts` | actual retry/fallback triggering |
| Session state model | `fallback-state.ts`, `types.ts` | retry bookkeeping |

## ANTI-PATTERNS

- Do not add generic “retry on anything” behavior; classification must remain explicit.
- Do not leak or orphan session retry state, timers, or timeout entries.
- Do not treat user cancellation the same as provider failure.
- Do not duplicate fallback-model resolution logic outside the dedicated helpers.
- Do not bypass logging/debug surfaces when changing retry semantics; this hook is operationally sensitive.

## VERIFICATION

- Read `hook.ts`, `event-handler.ts`, and `error-classifier.ts` together before editing behavior.
- Keep tests near the changed behavior; this subtree already has strong focused test coverage.
- Run package validation after edits:

```bash
bun run typecheck
bun test
bun run build
```
