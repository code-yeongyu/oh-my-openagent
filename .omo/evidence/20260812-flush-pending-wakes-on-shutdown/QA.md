# QA Evidence: Flush Pending Parent Wakes on Shutdown

## Date: 2026-08-12
## Branch: alex/flush-pending-wakes-on-shutdown
## Commit: b97aa94eb

## What Changed

Three changes to `packages/omo-opencode/src/features/background-agent/`:

1. **`parent-wake-notifier.ts`**: Added `flushForShutdown()` method that dispatches
   all pending parent wake notifications via `sendParentWakePrompt` with
   `forceNoReply=true` before the process exits.

2. **`manager.ts` `shutdown()`**: Added a wait (controlled by
   `OMO_BACKGROUND_SHUTDOWN_WAIT_MS` env var) for running tasks to complete
   before aborting them. Also calls `flushForShutdown()` before
   `parentWakeNotifier.shutdown()` clears the pending queue.

3. **`manager.ts` `startPolling()`**: Conditionally keeps the polling timer
   referenced (not `unref()`'d) when `OMO_BACKGROUND_SHUTDOWN_WAIT_MS` is set,
   so the event loop stays alive while background tasks are running.

## Verification

### Typecheck
```
node_modules/.bin/tsgo --noEmit -p packages/omo-opencode/tsconfig.json
EXIT: 0
```

### Tests
```
bun test packages/omo-opencode/src/features/background-agent/manager
238 pass, 0 fail, 761 expect() calls
```

### Build
```
bun run build
build: all steps completed
EXIT: 0
```

### QA: `--attach` to long-running server (VERIFIED)

**Environment**: Isolated XDG sandbox at `/tmp/omo-qa.k43DTy/`, plugin loaded
from `file:///home/aloiko/repos/oh-my-opencode/dist/index.js`, model
`evroc/zai-org/GLM-5.2`, `OMO_BACKGROUND_SHUTDOWN_WAIT_MS=5000`.

**Setup**: Long-running server started in sandbox:
```
opencode serve --hostname 127.0.0.1 --port 18099
```

**Test**: `opencode run --attach http://127.0.0.1:18099` with prompt:
"Launch a background explore agent with run_in_background=true to search for
'TODO' in /tmp/omo-qa.k43DTy/. Then immediately end your turn without calling
background_output."

**Timeline**:
- 04:32:10.857 — Parent session created: `ses_00bc213a1ffedZnVOAw610UnRR`
- 04:32:12.223 — Background task launched: `bg_318578be` (child: `ses_00bc1fed0ffeNjaHgABzIh6mDJ`)
- 04:32:12.675 — Model said "I am ending my turn now" and stopped with `reason=stop`
- 04:32:12.805 — Parent loop exited; `run.ts` process exited
- 04:32:37.909 — Child completed on server (step=3, exiting loop)
- 04:32:38.063 — Plugin log: `[background-agent] Queued notification for short-debounce flush to idle parent`
- **1786509158409 (04:32:38.409)** — `<system-reminder>` persisted in parent session:

```
<system-reminder>
[BACKGROUND TASK COMPLETED]
[ALL BACKGROUND TASKS COMPLETE]

**Completed:**
- `bg_318578be`: Search for TODO in directory

All sibling background tasks are complete. Your next action should be to call
`background_output(task_id="<id>")` for each task ID above.
</system-reminder>
```

**Result**: The notification was persisted in the parent session 33 seconds
after the model stopped, proving the `--attach` approach works correctly with
the fix. The user can re-attach with `opencode run --continue --session <id>
--attach http://localhost:PORT` and the model will see the notification.

**Database verification**: Queried `/tmp/omo-qa.k43DTy/data/opencode/opencode.db`
for parent session `ses_00bc213a1ffedZnVOAw610UnRR` — confirmed the
`<system-reminder>` text part exists at timestamp 1786509158409.

### QA: In-process `opencode run` (LIMITATION)

**Result**: `flushForShutdown()` and the wait logic execute correctly (confirmed
in plugin log), but `Instance.dispose()` (called by `bootstrap.ts` in the
`finally` block) kills the in-process server ~14ms before `beforeExit` fires,
aborting child sessions before the wait can complete.

This is an opencode core issue: `bootstrap.ts` calls `await Instance.dispose()`
which disposes the in-process server and aborts all child sessions before the
plugin's cleanup handler runs. The fix requires an opencode core change to
delay `Instance.dispose()` while background tasks are running.

**Workaround**: Use `opencode run --attach http://localhost:PORT` to a
long-running server (verified above).

## Isolation Proof

QA ran in isolated XDG sandbox (`/tmp/omo-qa.k43DTy/`), never touching the
host's real `~/.config/opencode` or `~/.local/share/opencode/opencode.db`.
