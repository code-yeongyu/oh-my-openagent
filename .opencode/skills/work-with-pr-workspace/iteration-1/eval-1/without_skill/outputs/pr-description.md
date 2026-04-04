# PR Description

**Title:** feat: add `maxBackgroundAgents` config to limit total simultaneous background agents

**Body:**

## Summary

- Add `maxBackgroundAgents` field to `BackgroundTaskConfigSchema` that enforces a global ceiling on total running background agents across all models/providers
- Modify `ConcurrencyManager` to track global count and enforce the limit alongside existing per-model limits
- Add schema validation tests and concurrency enforcement tests

## Motivation

Currently, concurrency is only limited per model/provider key (default 5 per key). On resource-constrained machines or when using many different models, the total number of background agents can grow unbounded (5 per model x N models). This config option lets users set a hard ceiling.

## Changes

### Schema (`src/config/schema/background-task.ts`)
- Added `maxBackgroundAgents: z.number().int().min(1).optional()` to `BackgroundTaskConfigSchema`
- Grouped with existing limit fields (`maxDepth`, `maxDescendants`)

### ConcurrencyManager (`src/features/background-agent/concurrency.ts`)
- Added `globalCount` tracking total active agents across all concurrency keys
- Added `getGlobalLimit()` reading `maxBackgroundAgents` from config (defaults to `Infinity` = no global limit)
- Modified `acquire()` to check both per-model AND global capacity
- Modified `release()` to decrement global count and drain cross-model waiters blocked by global limit
- Modified `clear()` to reset global state
- Added `getGlobalCount()` / `getGlobalQueueLength()` for testing

### Tests
- `src/config/schema/background-task.test.ts`: 6 test cases for schema validation (valid, min boundary, below min, negative, non-integer, undefined)
- `src/features/background-agent/concurrency.test.ts`: 8 test cases for global limit enforcement (cross-model blocking, release unblocking, per-model vs global interaction, no-config default, clear reset)

## Config Example

```jsonc
{
  "background_task": {
    "maxBackgroundAgents": 5,
    "defaultConcurrency": 3
  }
}
```

## Backward Compatibility

- When `maxBackgroundAgents` is not set (default), no global limit is enforced - behavior is identical to before
- Existing `defaultConcurrency`, `providerConcurrency`, and `modelConcurrency` continue to work unchanged
- No config migration needed
