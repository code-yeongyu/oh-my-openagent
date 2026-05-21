# Debugging Journal: session.status() Infinite Hang

**Date:** 2026-05-16
**Branch:** fix/status-timeout-hang
**Worktree:** mimo v2.5 pro
**Severity:** Critical — deadlocks entire plugin event chain

---

## Phase 0 — Environment

- **Runtime:** Bun 1.3.x (TypeScript, strict mode)
- **Host:** OpenCode plugin system (`oh-my-opencode`)
- **Symptom:** Plugin hangs forever during prompting — no hooks fire, no events processed, system becomes unresponsive
- **Reporter:** User reports "갑자기 프롬프팅하다가 뻗어버리는" (suddenly hangs while prompting)

---

## Phase 1 — Hypotheses

### H1: `isSessionActive()` has no timeout — CONFIRMED

`isSessionActive()` in `src/shared/session-idle-settle.ts` calls `client.session.status()` with NO timeout wrapper. The SDK client (`packages/sdk/js/src/client.ts`) explicitly disables fetch timeout:

```typescript
const customFetch: any = (req: any) => {
  req.timeout = false  // DISABLES TIMEOUT
  return fetch(req)
}
```

If the opencode server is slow or unresponsive, this call hangs forever.

### H2: Sequential `await` in `dispatchToHooks` propagates hang — CONFIRMED

`src/plugin/event.ts` calls hooks sequentially:

```typescript
const dispatchToHooks = async (input: EventInput): Promise<void> => {
  await runEventHookSafely("todoContinuationEnforcer", ...)
  await runEventHookSafely("runtimeFallback", ...)
  await runEventHookSafely("atlasHook", ...)
  // ... 20+ hooks, ALL sequential await
}
```

`runEventHookSafely` catches errors but has NO timeout. If any hook hangs, the entire chain is blocked.

### H3: Reservation deadlock — CONFIRMED (secondary effect)

In `dispatchAfterSessionIdle()`:
1. Reservation is set BEFORE `isSessionActive()` call
2. If `isSessionActive()` hangs, the `finally` block never runs
3. Reservation is never released
4. All subsequent calls for the same sessionID return "reserved"

### H4: Multiple hooks trigger same hang path — CONFIRMED

At least 6 hooks call `promptAsyncAfterSessionIdle` or `shouldPromptAfterSessionIdle`:
- `todoContinuationEnforcer` (main session continuation)
- `atlasHook` (boulder session continuation)
- `ralphLoop` (ralph loop continuation)
- `runtimeFallback` (error recovery)
- `sessionRecovery` (session resume)
- `teamIdleWakeHint` (team mode wake)

---

## Root Cause

`isSessionActive()` in `session-idle-settle.ts` has no timeout on `client.session.status()`. The SDK client disables fetch timeout. When opencode server is slow/unresponsive:

1. `isSessionActive()` hangs forever
2. `dispatchAfterSessionIdle()` hangs (reservation never released)
3. `dispatchToHooks()` hangs (sequential await blocks all subsequent hooks)
4. Plugin becomes completely unresponsive

---

## Fix Plan

Add timeout wrapper to `isSessionActive()`. If status call exceeds threshold (5s), treat session as inactive (return false). This is safe because:
- If the server is unresponsive, we can't trust the status anyway
- Returning false lets the caller proceed (dispatch or skip)
- The reservation mechanism prevents duplicate dispatches even with false negatives

**Files to change:**
- `src/shared/session-idle-settle.ts` — add timeout to `isSessionActive()`
- `src/hooks/shared/session-idle-settle.test.ts` — add timeout behavior test
- `src/hooks/shared/prompt-async-gate.test.ts` — add status-timeout recovery test

---

## Verification

- [ ] Existing tests pass (no behavioral change for normal flow)
- [ ] New test: `isSessionActive` returns false when status call hangs
- [ ] New test: `dispatchAfterSessionIdle` recovers from status timeout
- [ ] `bun test` green
- [ ] `bun run typecheck` green
