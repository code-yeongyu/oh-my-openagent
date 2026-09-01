# src/hooks/ralph-loop/ -- Self-Referential Dev Loop

**Generated:** 2026-07-17

## OVERVIEW

**DEPRECATED.** Superseded by [`goal/`](../goal/) (PR #6184 "goal-replaces-ralph"). `ralphLoop` was removed from `HookNameSchema` and `create-session-hooks.ts`; the `/ralph-loop`, `/ulw-loop`, `/cancel-ralph` builtin commands and templates were removed; `ralph_loop` config is a deprecated passthrough for migration. The directory, `createRalphLoopHook` factory, and barrel export remain, but no composer imports them.

~52 .ts files (31 impl + 21 tests). Iterates a development loop until the agent emits `<promise>DONE</promise>` or max iterations reached. No longer wired into any tier.

## LOOP LIFECYCLE

```
/ralph-loop → startLoop(sessionID, prompt, options)
  → loopState.startLoop() → persists state to .omo/ralph-loop.local.md
  → session.idle events → createRalphLoopEventHandler()
    → completionPromiseDetector: scan output for <promise>DONE</promise>
    → if not done: inject continuation prompt → loop
    → if done or maxIterations: cancelLoop()
```

## KEY FILES

| File | Purpose |
|------|---------|
| `ralph-loop-hook.ts` | `createRalphLoopHook()` -- composes controller + recovery + event handler |
| `ralph-loop-event-handler.ts` | `createRalphLoopEventHandler()` -- handles session.idle, drives loop |
| `loop-state-controller.ts` | State CRUD: startLoop, cancelLoop, getState, persist to disk |
| `loop-session-recovery.ts` | Recover from crashed/interrupted loop sessions |
| `completion-promise-detector.ts` | Scan session transcript for `<promise>DONE</promise>` |
| `continuation-prompt-builder.ts` | Build continuation message for next iteration |
| `continuation-prompt-injector.ts` | Inject built prompt into active session |
| `storage.ts` | Read/write `.omo/ralph-loop.local.md` state file |
| `message-storage-directory.ts` | Temp dir for prompt injection |
| `with-timeout.ts` | API call wrapper with timeout (default 5000ms) |
| `types.ts` | `RalphLoopState`, `RalphLoopOptions`, loop iteration types |

## STATE FILE

```
.omo/ralph-loop.local.md  (gitignored)
  → sessionID, prompt, iteration count, maxIterations, completionPromise, ultrawork flag
```

## OPTIONS

```typescript
startLoop(sessionID, prompt, {
  maxIterations?: number  // Default from config (default: 100)
  completionPromise?: string  // Custom "done" signal (default: "<promise>DONE</promise>")
  ultrawork?: boolean  // Enable ultrawork mode for iterations
})
```

## EXPORTED INTERFACE

```typescript
interface RalphLoopHook {
  event: (input) => Promise<void>  // session.idle handler
  startLoop: (sessionID, prompt, options?) => boolean
  cancelLoop: (sessionID) => boolean
  getState: () => RalphLoopState | null
}
```
