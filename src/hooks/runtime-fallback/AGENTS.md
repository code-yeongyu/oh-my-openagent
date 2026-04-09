# src/hooks/runtime-fallback/ — Reactive Provider Error Recovery

**Generated:** 2026-04-09

## OVERVIEW

32 files. Session Tier hook that **reactively** switches to fallback models when API providers return errors at runtime (429, 503, quota exhausted, cooldown signals). Distinct from `model-fallback` (which applies preemptively at chat.params).

## RUNTIME-FALLBACK vs MODEL-FALLBACK

| Aspect | runtime-fallback | model-fallback |
|--------|-----------------|----------------|
| **Trigger** | Reactive — after error occurs | Proactive — at request time |
| **Event** | session.error, message.updated, session.status | chat.params |
| **Config source** | `categories[].fallback_models`, `agents[].fallback_models` | `AGENT_MODEL_REQUIREMENTS` hardcoded chains |
| **State** | Per-session FallbackState + cooldown tracking | Module-global pendingModelFallbacks |
| **Use case** | Provider errors during execution | Pre-configured agent fallback chains |

They operate **independently** — no direct integration.

## ERROR DETECTION

### HTTP Status Codes (configurable)
Default retry codes: `429, 500, 502, 503, 504`

### Error Message Patterns (constants.ts)
```
/rate.?limit/i, /too.?many.?requests/i, /quota.*reset.*after/i,
/exhausted.*capacity/i, /all.*credentials.*for.*model/i,
/cool(?:ing)?.?down/i, /model.*not.*supported/i,
/service.?unavailable/i, /overloaded/i, /temporarily.?unavailable/i
```

### Error Type Classification (error-classifier.ts)
- `missing_api_key` — provider rejects auth
- `model_not_found` — model unavailable
- `quota_exceeded` — billing/quota hit
- Auto-retry signal detection via `auto-retry-signal.ts` — extracts "retrying in ~2 weeks" style signals, triggers immediate fallback

## FALLBACK STATE MACHINE

```typescript
interface FallbackState {
  originalModel: string
  currentModel: string
  fallbackIndex: number
  failedModels: Map<string, number>  // model → cooldown-until timestamp
  attemptCount: number
  pendingFallbackModel?: string
}
```

## FALLBACK CHAIN RESOLUTION (fallback-models.ts)

Priority order:
1. **Session category** (via SessionCategoryRegistry)
2. **Agent config** `fallback_models`
3. **Agent's category** `fallback_models`
4. **Session ID pattern match** (detect agent from session ID format)

## RETRY FLOW

```
session.error / message.updated (with error) / session.status (retry signal)
  → isRetryableError(error)?
  → getFallbackModelsForSession(sessionID, agent)
  → findNextAvailableFallback() — skip cooldown models
  → prepareFallback() — update state, mark current failed
  → dispatchFallbackRetry() — toast notification + promptAsync with new model
  → 30s timeout — abort and try next if exceeded
```

## COOLDOWN MECHANISM

Failed models enter 60s cooldown. `findNextAvailableFallback()` skips models in cooldown, preventing thrashing on persistently failing models.

## KEY FILES

| File | Purpose |
|------|---------|
| `hook.ts` | `createRuntimeFallbackHook()` — composes all handlers |
| `event-handler.ts` | Route session lifecycle (created, error, stop, idle) |
| `message-update-handler.ts` | Handle error parts in `message.updated` |
| `session-status-handler.ts` | Handle provider retry signals in session.status |
| `chat-message-handler.ts` | Apply fallback model override on chat.message |
| `error-classifier.ts` | `isRetryableError()`, `classifyErrorType()` |
| `auto-retry-signal.ts` | Extract "retrying in..." signals |
| `fallback-state.ts` | State machine: createFallbackState, prepareFallback, findNextAvailableFallback, isModelInCooldown |
| `fallback-models.ts` | Resolve chain from config hierarchy (strings + raw objects) |
| `fallback-bootstrap-model.ts` | Derive initial model when state missing |
| `fallback-retry-dispatcher.ts` | Toast + dispatch retry orchestration |
| `auto-retry.ts` | Abort, timeout scheduling, cleanup |
| `agent-resolver.ts` | Session → agent name normalization |
| `retry-model-payload.ts` | Build model payload (providerID/modelID/variant/reasoningEffort) |
| `visible-assistant-response.ts` | Detect if assistant produced real output vs just errors |
| `last-user-retry-parts.ts` | Extract last user message parts for retry |

## NOTES

- Cooldown and failure tracking are **per-session** — concurrent sessions don't share state
- `visible-assistant-response.ts` prevents retry if the assistant already produced a partial valid response
- Runtime-fallback is registered in the Session Tier via `create-session-hooks.ts`
