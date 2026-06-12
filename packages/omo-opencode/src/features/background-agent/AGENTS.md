# src/features/background-agent/ — Core Orchestration Engine

**Generated:** 2026-05-20

## OVERVIEW

45 non-test files. Manages async task lifecycle: launch → queue → run → poll → complete/error. Concurrency limited per model/provider (default 5). Central to multi-agent orchestration.

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
| `types.ts` | `BackgroundTask`, `LaunchInput`, `ResumeInput`, `BackgroundTaskStatus` |
| `parent-wake-notifier.ts` | 587 LOC. Dependency-injected client + enqueue callback. Notifies parent session when a background task wants attention. |
| `loop-detector.ts` | Detects polling/event loops that would otherwise burn budget. |
| `error-classifier.ts` | Maps raw provider errors → `BackgroundTaskError` categories. |
| `fallback-retry-handler.ts` | Coordinates retries with the runtime-fallback system. |
| `process-cleanup.ts` | Best-effort cleanup on parent exit. `OMO_DISABLE_PROCESS_CLEANUP=1` opts out entirely. |
| `subagent-spawn-limits.ts` | Enforces per-parent subagent spawn caps. |
| `session-status-classifier.ts` | Normalizes OpenCode session status across versions. |
| `compaction-aware-message-resolver.ts` | Resolves task result content even across mid-task compaction. |
| `attempt-lifecycle.ts` | Tracks retry attempts on a single task. |
| `task-history.ts` | Append-only history for completed tasks. |
| `session-idle-event-handler.ts` | Bridges OpenCode `session.idle` → task-poller completion signal. |
| `session-existence.ts` | Cheap existence check used by recovery code. |
| `abort-with-timeout.ts` | Force-abort tasks past `syncPollTimeoutMs`. |
| `remove-task-toast-tracking.ts` | Strips lingering toast tracker entries on task end. |
| `background-task-notification-template.ts` | Template for parent-session result injection. |

## SPAWNER SUBDIRECTORY

| File | Purpose |
|------|---------|
| `spawner-context.ts` | `SpawnerContext` interface composing all spawner deps |
| `background-session-creator.ts` | Create OpenCode session for background task |
| `concurrency-key-from-launch-input.ts` | Derive concurrency key from model/provider |
| `tmux-callback-invoker.ts` | Notify TmuxSessionManager on session creation |

## COMPLETION DETECTION

Two signals combined:
1. **Session idle event** — OpenCode reports session became idle
2. **Stability detection** — message count unchanged for 10s (3+ stable polls at 3s interval)

Both must agree before marking a task complete. Prevents premature completion on brief pauses.

## CONCURRENCY MODEL

- Key format: `{providerID}/{modelID}` (e.g., `anthropic/claude-opus-4-7`)
- Default limit: 5 concurrent per key (configurable via `background_task` config)
- FIFO queue: tasks wait in order when slots full
- Slot released on: completion, error, cancellation

## NOTIFICATION FLOW

```
task completed → result-handler → parent-session-notifier → inject system message into parent session
```
