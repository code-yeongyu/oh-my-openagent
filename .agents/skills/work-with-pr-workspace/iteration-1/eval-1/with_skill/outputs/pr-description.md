# PR Description

**Title:** `feat: add max_background_agents config to limit concurrent background agents`

**Base:** `dev`

---

## Summary

- Add `maxBackgroundAgents` field to `BackgroundTaskConfigSchema` (default: 5, min: 1) to cap total simultaneous background agents across all models/providers
- Enforce the global limit in `BackgroundManager.launch()` and `trackTask()` with descriptive error messages when the limit is hit
- Release global slots on task completion, cancellation, error, and interrupt to prevent slot leaks

## Motivation

The existing concurrency system in `ConcurrencyManager` limits agents **per model/provider** (e.g., 5 concurrent `anthropic/claude-opus-4-6` tasks). However, there is no **global** cap across all models. A user running tasks across multiple providers could spawn an unbounded number of background agents, exhausting system resources.

`max_background_agents` provides a single knob to limit total concurrent background agents regardless of which model they use.

## Config Usage

```jsonc
// .opencode/oh-my-opencode.jsonc
{
  "background_task": {
    "maxBackgroundAgents": 10  // default: 5, min: 1
  }
}
```

## Changes

| File | What |
|------|------|
| `src/config/schema/background-task.ts` | Add `maxBackgroundAgents` schema field |
| `src/config/schema/background-task.test.ts` | Validation tests (valid, boundary, invalid) |
| `src/features/background-agent/concurrency.ts` | Global counter + `canSpawnGlobally()` / `acquireGlobal()` / `releaseGlobal()` |
| `src/features/background-agent/concurrency.test.ts` | Global limit unit tests |
| `src/features/background-agent/manager.ts` | Enforce global limit in `launch()`, `trackTask()`; release in completion/cancel/error paths |

## Testing

- `bun test src/config/schema/background-task.test.ts` — schema validation
- `bun test src/features/background-agent/concurrency.test.ts` — global limit enforcement
- `bun run typecheck` — clean
- `bun run build` — clean
