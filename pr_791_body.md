## Summary

Adds an automatic model fallback system that gracefully handles API failures by retrying with configured fallback models.

## Features

### Automatic Fallback on Transient Errors

When a model fails due to transient errors, the system automatically retries with fallback models:

- **Rate limits** (`rate_limit`, HTTP 429)
- **Service unavailable** (HTTP 503, 502)
- **Capacity issues** (`overloaded`, `capacity`, `unavailable`)
- **Network errors** (`timeout`, `ECONNREFUSED`, `ENOTFOUND`)

Non-model errors (authentication failures, invalid input) are NOT retried.

### Configuration

```json
{
  "agents": {
    "oracle": {
      "model": "openai/gpt-5.2",
      "fallback": ["deepseek/deepseek-r1", "anthropic/claude-opus-4-5"],
      "fallbackDelayMs": 1000,
      "fallbackRetryCount": 3
    }
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `fallback` | `[]` | Array of fallback models to try |
| `fallbackDelayMs` | `1000` | Delay between retry attempts (100-30000ms) |
| `fallbackRetryCount` | chain length | Max models to try |

### User Notification

Users are notified when fallback occurs in the task completion message:

**Normal completion:**
```
Task completed in 5.2s.

Agent: Sisyphus-Junior (category: general)
Model: deepseek/deepseek-v3-2
Session ID: ses_abc123
```

**Fallback occurred:**
```
Task completed in 8.1s.

Agent: Sisyphus-Junior (category: general)
Model: anthropic/claude-haiku-4-5
⚠️ Model fallback occurred: Primary model failed, used anthropic/claude-haiku-4-5 instead.
   Failed models: deepseek/deepseek-v3-2
Session ID: ses_abc123
```

## Implementation

### New Module: `src/features/model-fallback/`

Core utilities for model fallback:
- `parseModelString()` - Parse "provider/model" format
- `buildModelChain()` - Build ordered list of models to try
- `isModelError()` - Detect retryable errors
- `withModelFallback()` - Generic retry wrapper
- `formatRetryErrors()` - Format error list for display

### Integration with sisyphus-task

- Updated `resolveCategoryConfig()` to return `modelChain` and `retryConfig`
- Inline retry logic with configurable delay and max attempts
- Special handling: agent configuration errors do NOT trigger fallback
- Model used and fallback status included in completion message

### Bug Fixes

- P1: Fixed `maxAttempts: 0` when no category (now defaults to 1)
- P2: Preserve variant on primary model when building modelChain
- P2: Clean up `subagentSessions` on early returns (memory leak)
- P2: Ensure maxAttempts >= 1 even with empty modelChain
- P2: Updated warning text to use generic model descriptions

## Testing

- **36 unit tests** covering all model-fallback functions
- All tests passing ✅
- HTTP transport tests also pass
- Build and typecheck pass

## Breaking Changes

None. The feature is backward compatible. Existing configurations without fallback fields continue to work as before.

## Related

Fixes PR #785 authorship issue

PR #790 includes the HTTP transport feature from PR #773 as well.