# RFC: Runtime Model Fallback (Per-Agent Fallback Models)

## Summary

Enable per-agent runtime model fallback configuration, allowing automatic switching to backup models when the primary model fails (rate limit, overload, unavailable, etc.).

## Motivation

### Current Limitation

The existing Model Resolution System operates **only at agent initialization time**:

```
┌─────────────────────────────────────────────────────┐
│              CURRENT: STARTUP-ONLY RESOLUTION        │
├─────────────────────────────────────────────────────┤
│                                                     │
│   Agent Start → Resolve Model → Fixed for Session   │
│                                                     │
│   If model fails mid-session:                       │
│   ❌ No automatic recovery                          │
│   ❌ User must restart or manually switch           │
│   ❌ Work-in-progress is interrupted                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Problem Scenarios

1. **Rate Limiting**: Claude Opus hits rate limit mid-task, entire session stalls
2. **Provider Outage**: OpenAI goes down, all GPT-based agents become unusable
3. **Quota Exhaustion**: User exhausts monthly quota on primary model
4. **Overloaded Models**: Model returns 503/529, no automatic retry with alternative

### Desired Behavior

```
┌─────────────────────────────────────────────────────┐
│              PROPOSED: RUNTIME FALLBACK              │
├─────────────────────────────────────────────────────┤
│                                                     │
│   Request Fails → Check Error Type → Try Next Model │
│                                                     │
│   Supported error types:                            │
│   ✓ 429 Rate Limit Exceeded                         │
│   ✓ 503 Service Unavailable                         │
│   ✓ 529 Overloaded                                  │
│   ✓ Quota exceeded                                  │
│   ✓ Model not available                             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Proposed Configuration

### Per-Agent Fallback Models

```jsonc
{
  "agents": {
    "sisyphus": {
      "model": "google/antigravity-claude-opus-4-5-thinking",
      "fallback_models": [
        "anthropic/claude-opus-4-5",
        "openai/gpt-5.2",
        "google/gemini-3-pro"
      ]
    },
    "oracle": {
      "model": "openai/gpt-5.2",
      "fallback_models": [
        "anthropic/claude-opus-4-5",
        "google/gemini-3-pro"
      ]
    },
    "explore": {
      "model": "google/antigravity-gemini-3-flash",
      "fallback_models": [
        "anthropic/claude-haiku-4-5",
        "opencode/gpt-5-nano"
      ]
    }
  }
}
```

### Global Fallback Configuration

```jsonc
{
  "runtime_fallback": {
    "enabled": true,
    "retry_on_errors": [429, 503, 529],
    "max_fallback_attempts": 3,
    "cooldown_seconds": 60,
    "notify_on_fallback": true
  }
}
```

### Category-Level Fallback

```jsonc
{
  "categories": {
    "ultrabrain": {
      "model": "openai/gpt-5.2-codex",
      "fallback_models": [
        "anthropic/claude-opus-4-5",
        "google/gemini-3-pro"
      ]
    }
  }
}
```

## Schema Changes

### AgentConfig Extension

```typescript
// src/config/schema.ts
const AgentConfigSchema = z.object({
  model: z.string().optional(),
  fallback_models: z.union([z.string(), z.array(z.string())]).optional(), // NEW - supports string or array
  // ... existing fields
})
```

### RuntimeFallbackConfig (New)

```typescript
const RuntimeFallbackConfigSchema = z.object({
  enabled: z.boolean().default(true),
  retry_on_errors: z.array(z.number()).default([429, 503, 529]),
  max_fallback_attempts: z.number().min(1).max(10).default(3),
  cooldown_seconds: z.number().min(0).default(60),
  notify_on_fallback: z.boolean().default(true),
})
```

## Implementation Approach

### Option A: Hook-Based (Recommended)

Create a new hook `model-fallback-handler` that:

1. Intercepts API errors via `PostToolUse` or dedicated error hook
2. Detects fallback-eligible errors (429, 503, 529, quota)
3. Swaps model in session config
4. Retries the request with fallback model
5. Notifies user of model switch

**Pros**:
- Non-invasive, follows existing hook pattern
- Easy to disable via `disabled_hooks`
- Testable in isolation

**Cons**:
- May need SDK support for mid-session model switching
- Hook timing might not catch all error scenarios

### Option B: SDK Integration

Request OpenCode SDK to support runtime model switching:

1. Add `setModel(modelId)` method to session/client
2. Add error callback with model retry capability
3. Plugin registers fallback handler

**Pros**:
- Clean integration with SDK
- Full control over retry logic

**Cons**:
- Requires SDK changes
- Longer implementation timeline

### Option C: Wrapper Approach

Wrap API calls in retry logic with model rotation:

1. Create `FallbackAwareClient` wrapper
2. Intercept all model calls
3. Handle errors with fallback logic
4. Pass through to real client

**Pros**:
- Works without SDK changes
- Full control over behavior

**Cons**:
- More complex implementation
- Potential for state inconsistency

## Fallback Logic Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    RUNTIME FALLBACK FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. API Request with Primary Model                             │
│                  │                                              │
│                  ▼                                              │
│   2. Response Received                                          │
│          │              │                                       │
│      Success         Error                                      │
│          │              │                                       │
│          ▼              ▼                                       │
│      Return         3. Check Error Type                         │
│                         │                                       │
│              ┌──────────┴──────────┐                            │
│              │                     │                            │
│         Fallback-Eligible     Not Eligible                      │
│         (429/503/529/quota)   (400/401/etc)                     │
│              │                     │                            │
│              ▼                     ▼                            │
│         4. Check Fallback      Throw Error                      │
│            Models Available                                     │
│              │                                                  │
│       ┌──────┴──────┐                                           │
│       │             │                                           │
│    Has Fallback  No Fallback                                    │
│       │             │                                           │
│       ▼             ▼                                           │
│   5. Switch      Throw Original                                 │
│      Model       Error                                          │
│       │                                                         │
│       ▼                                                         │
│   6. Notify User (if enabled)                                   │
│       │                                                         │
│       ▼                                                         │
│   7. Retry Request                                              │
│       │                                                         │
│       ▼                                                         │
│   8. Continue from Step 2                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## State Management

### Fallback State Tracking

```typescript
interface FallbackState {
  originalModel: string
  currentModel: string
  fallbackIndex: number
  lastFallbackTime: number
  failedModels: Set<string>
}
```

### Cooldown & Recovery

- Track failed models per session
- Apply cooldown before retrying failed model
- Optionally recover to primary model after cooldown

## User Notification

When fallback occurs, notify user via:

1. **Toast Notification**: "Model switched: claude-opus-4-5 → gpt-5.2 (rate limit)"
2. **Session Log**: Record model switches for debugging
3. **Status Indicator**: Show current active model in UI

## Backward Compatibility

- `fallback_models` is optional - existing configs work unchanged
- `runtime_fallback.enabled` defaults to `true` when `fallback_models` is configured
- No breaking changes to existing behavior

## Testing Strategy

1. **Unit Tests**: 
   - Error detection logic
   - Fallback model rotation
   - Cooldown handling
   - State management

2. **Integration Tests**:
   - Mock 429/503/529 responses
   - Verify model switching
   - Test notification flow

3. **E2E Tests**:
   - Real rate limit scenarios (with test accounts)
   - Multi-fallback chain traversal

## Open Questions

1. **Should fallback be session-scoped or request-scoped?**
   - Session: Switch model for entire session
   - Request: Only for failed request, reset on next

2. **Should we support fallback for specific operations only?**
   - e.g., Only fallback for code generation, not for exploration

3. **How to handle variant compatibility?**
   - Primary: `claude-opus-4-5` with `variant: max`
   - Fallback: `gpt-5.2` - what variant to use?

4. **SDK support requirements?**
   - Does OpenCode SDK support mid-session model switching?
   - If not, what's the workaround?

## Related Work

- Current Model Resolution: `src/shared/model-resolver.ts`
- Model Requirements: `src/shared/model-requirements.ts`
- Config Handler: `src/plugin-handlers/config-handler.ts`
- Delegate Task Retry Hook: `src/hooks/delegate-task-retry/`

## Timeline Estimate

| Phase | Effort | Description |
|-------|--------|-------------|
| Schema + Config | 2h | Add fallback_models to schema |
| Fallback Logic | 4h | Implement core fallback handler |
| Hook Integration | 4h | Wire into hook system |
| Notification | 2h | User notification system |
| Testing | 4h | Unit + integration tests |
| Documentation | 2h | Update configs.md |
| **Total** | **~18h** | |

## References

- [OpenCode SDK Documentation](https://opencode.ai/docs/)
- [Anthropic Rate Limits](https://docs.anthropic.com/en/api/rate-limits)
- [OpenAI Rate Limits](https://platform.openai.com/docs/guides/rate-limits)
