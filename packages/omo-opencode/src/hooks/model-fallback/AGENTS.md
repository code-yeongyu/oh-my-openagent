# model-fallback — Proactive Model Selection

## OVERVIEW

Session-tier hook that applies configured fallback chains before a request runs. It is distinct from `../runtime-fallback/`, which reacts to provider errors after execution; this directory owns the proactive chat-message path and its pending per-session state.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Hook entry and chat handling | `hook.ts` |
| Fallback state/controller | `fallback-state-controller.ts`, `controller-accessor.ts` |
| Next reachable model | `next-fallback.ts` |
| Chat override | `chat-message-fallback-handler.ts` |
| Accessor barrel | `index.ts` (exports only `createModelFallbackControllerAccessor`) |

## CONVENTIONS

- `createModelFallbackHook` is reached through the parent `src/hooks` barrel, not through this directory's `index.ts`.
- The returned hook object exposes the controller methods (`setSessionFallbackChain`, `getNextFallback`, `hasPendingModelFallback`, `reset`, ...) alongside its `chat.message` handler.
- Keep mutable fallback state behind the controller/accessor seam; tests use `_resetForTesting`.
- Resolve the next reachable model from the configured chain rather than assuming every candidate is available.
- Hook handlers return lifecycle-keyed objects and mutate/replace model arguments only at the proactive request boundary.
- Tests use Bun and isolate module state explicitly.

## ANTI-PATTERNS

- Do not merge this proactive path with reactive runtime-fallback behavior.
- Do not leave pending fallback state after a session completes or a fallback is consumed.
- Do not read or mutate the pending maps directly; go through the controller so toast dedup keys stay consistent.
- Do not select a model without honoring reachability and session context checks.
