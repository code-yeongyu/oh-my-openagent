# src/features/background-agent/ — Core Orchestration Engine

**Generated:** 2026-02-18

## OVERVIEW

39 files (~10k LOC). Manages async task lifecycle: launch → queue → run → poll → complete/error. Concurrency limited per model/provider (default 5). Central to multi-agent orchestration.

## TASK LIFECYCLE

```
LaunchInput → pending → [ConcurrencyManager queue] → running → polling → completed/error/cancelled/interrupt
```

## KEY FILES

| File | Purpose |
|------|---------|
| `manager.ts` | `BackgroundManager` — main class: launch, cancel, getTask, listTasks |
| `spawner.ts` | Task spawning: create session → inject prompt → start polling |
| `concurrency.ts` | `ConcurrencyManager` — FIFO queue per concurrency key, slot acquisition/release |
| `task-poller.ts` | 3s interval polling, completion via idle events + stability detection (10s unchanged) |
| `result-handler.ts` | Process completed tasks: extract result, notify parent, cleanup |
| `state.ts` | In-memory task store (Map-based) |
| `types.ts` | `BackgroundTask`, `LaunchInput`, `ResumeInput`, `BackgroundTaskStatus` |

## SPAWNER SUBDIRECTORY (6 files)

| File | Purpose |
|------|---------|
| `spawner-context.ts` | `SpawnerContext` interface composing all spawner deps |
| `background-session-creator.ts` | Create OpenCode session for background task |
| `concurrency-key-from-launch-input.ts` | Derive concurrency key from model/provider |
| `parent-directory-resolver.ts` | Resolve working directory for child session |
| `tmux-callback-invoker.ts` | Notify TmuxSessionManager on session creation |

## COMPLETION DETECTION

Two signals combined:
1. **Session idle event** — OpenCode reports session became idle
2. **Stability detection** — message count unchanged for 10s (3+ stable polls at 3s interval)

Both must agree before marking a task complete. Prevents premature completion on brief pauses.

## CONCURRENCY MODEL

- Key format: `{providerID}/{modelID}` (e.g., `anthropic/claude-opus-4-6`)
- Default limit: 5 concurrent per key (configurable via `background_task` config)
- FIFO queue: tasks wait in order when slots full
- Slot released on: completion, error, cancellation

## NOTIFICATION FLOW

```
task completed → result-handler → parent-session-notifier → inject system message into parent session
```
