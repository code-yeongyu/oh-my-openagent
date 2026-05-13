# Code Changes: Fix Atlas Hook Crash on Missing worktree_path

## Change 1: Harden `readBoulderState()` validation

**File:** `src/features/boulder-state/storage.ts`

### Before (lines 16-36):
```typescript
export function readBoulderState(directory: string): BoulderState | null {
  const filePath = getBoulderFilePath(directory)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }
    if (!Array.isArray(parsed.session_ids)) {
      parsed.session_ids = []
    }
    return parsed as BoulderState
  } catch {
    return null
  }
}
```

### After:
```typescript
export function readBoulderState(directory: string): BoulderState | null {
  const filePath = getBoulderFilePath(directory)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }
    if (typeof parsed.active_plan !== "string" || typeof parsed.plan_name !== "string") {
      return null
    }
    if (!Array.isArray(parsed.session_ids)) {
      parsed.session_ids = []
    }
    if (parsed.worktree_path !== undefined && typeof parsed.worktree_path !== "string") {
      delete parsed.worktree_path
    }
    return parsed as BoulderState
  } catch {
    return null
  }
}
```

**Rationale:** Validates that required fields (`active_plan`, `plan_name`) are strings. Strips `worktree_path` if it's present but not a string (e.g., `null`, number). This prevents downstream crashes from `existsSync(undefined)` and ensures type safety at the boundary.

---

## Change 2: Add try/catch in setTimeout retry callback

**File:** `src/hooks/atlas/idle-event.ts`

### Before (lines 62-88):
```typescript
sessionState.pendingRetryTimer = setTimeout(async () => {
    sessionState.pendingRetryTimer = undefined

    if (sessionState.promptFailureCount >= 2) return
    if (sessionState.waitingForFinalWaveApproval) return

    const currentBoulder = readBoulderState(ctx.directory)
    if (!currentBoulder) return
    if (!currentBoulder.session_ids?.includes(sessionID)) return

    const currentProgress = getPlanProgress(currentBoulder.active_plan)
    if (currentProgress.isComplete) return
    if (options?.isContinuationStopped?.(sessionID)) return
    if (options?.shouldSkipContinuation?.(sessionID)) return
    if (hasRunningBackgroundTasks(sessionID, options)) return

    await injectContinuation({
      ctx,
      sessionID,
      sessionState,
      options,
      planName: currentBoulder.plan_name,
      progress: currentProgress,
      agent: currentBoulder.agent,
      worktreePath: currentBoulder.worktree_path,
    })
  }, RETRY_DELAY_MS)
```

### After:
```typescript
sessionState.pendingRetryTimer = setTimeout(async () => {
    sessionState.pendingRetryTimer = undefined

    try {
      if (sessionState.promptFailureCount >= 2) return
      if (sessionState.waitingForFinalWaveApproval) return

      const currentBoulder = readBoulderState(ctx.directory)
      if (!currentBoulder) return
      if (!currentBoulder.session_ids?.includes(sessionID)) return

      const currentProgress = getPlanProgress(currentBoulder.active_plan)
      if (currentProgress.isComplete) return
      if (options?.isContinuationStopped?.(sessionID)) return
      if (options?.shouldSkipContinuation?.(sessionID)) return
      if (hasRunningBackgroundTasks(sessionID, options)) return

      await injectContinuation({
        ctx,
        sessionID,
        sessionState,
        options,
        planName: currentBoulder.plan_name,
        progress: currentProgress,
        agent: currentBoulder.agent,
        worktreePath: currentBoulder.worktree_path,
      })
    } catch (error) {
      log(`[${HOOK_NAME}] Retry continuation failed`, { sessionID, error: String(error) })
    }
  }, RETRY_DELAY_MS)
```

**Rationale:** The async callback in setTimeout creates a floating promise. Without try/catch, any error becomes an unhandled rejection that can crash the process. This is the critical safety net even after the `readBoulderState` fix.

---

## Change 3: Defensive guard in `getPlanProgress`

**File:** `src/features/boulder-state/storage.ts`

### Before (lines 115-118):
```typescript
export function getPlanProgress(planPath: string): PlanProgress {
  if (!existsSync(planPath)) {
    return { total: 0, completed: 0, isComplete: true }
  }
```

### After:
```typescript
export function getPlanProgress(planPath: string): PlanProgress {
  if (typeof planPath !== "string" || !existsSync(planPath)) {
    return { total: 0, completed: 0, isComplete: true }
  }
```

**Rationale:** Defense-in-depth. Even though `readBoulderState` now validates `active_plan`, the `getPlanProgress` function is a public API that could be called from other paths with invalid input. A `typeof` check before `existsSync` prevents the TypeError from `existsSync(undefined)`.

---

## Change 4: New tests

### File: `src/features/boulder-state/storage.test.ts` (additions)

```typescript
test("should return null when active_plan is missing", () => {
  // given - boulder.json without active_plan
  const boulderFile = join(SISYPHUS_DIR, "boulder.json")
  writeFileSync(boulderFile, JSON.stringify({
    started_at: "2026-01-01T00:00:00Z",
    session_ids: ["ses-1"],
    plan_name: "plan",
  }))

  // when
  const result = readBoulderState(TEST_DIR)

  // then
  expect(result).toBeNull()
})

test("should return null when plan_name is missing", () => {
  // given - boulder.json without plan_name
  const boulderFile = join(SISYPHUS_DIR, "boulder.json")
  writeFileSync(boulderFile, JSON.stringify({
    active_plan: "/path/to/plan.md",
    started_at: "2026-01-01T00:00:00Z",
    session_ids: ["ses-1"],
  }))

  // when
  const result = readBoulderState(TEST_DIR)

  // then
  expect(result).toBeNull()
})

test("should strip non-string worktree_path from boulder state", () => {
  // given - boulder.json with worktree_path set to null
  const boulderFile = join(SISYPHUS_DIR, "boulder.json")
  writeFileSync(boulderFile, JSON.stringify({
    active_plan: "/path/to/plan.md",
    started_at: "2026-01-01T00:00:00Z",
    session_ids: ["ses-1"],
    plan_name: "plan",
    worktree_path: null,
  }))

  // when
  const result = readBoulderState(TEST_DIR)

  // then
  expect(result).not.toBeNull()
  expect(result!.worktree_path).toBeUndefined()
})

test("should preserve valid worktree_path string", () => {
  // given - boulder.json with valid worktree_path
  const boulderFile = join(SISYPHUS_DIR, "boulder.json")
  writeFileSync(boulderFile, JSON.stringify({
    active_plan: "/path/to/plan.md",
    started_at: "2026-01-01T00:00:00Z",
    session_ids: ["ses-1"],
    plan_name: "plan",
    worktree_path: "/valid/worktree/path",
  }))

  // when
  const result = readBoulderState(TEST_DIR)

  // then
  expect(result).not.toBeNull()
  expect(result!.worktree_path).toBe("/valid/worktree/path")
})
```

### File: `src/features/boulder-state/storage.test.ts` (getPlanProgress additions)

```typescript
test("should handle undefined planPath without crashing", () => {
  // given - undefined as planPath (from malformed boulder state)

  // when
  const progress = getPlanProgress(undefined as unknown as string)

  // then
  expect(progress.total).toBe(0)
  expect(progress.isComplete).toBe(true)
})
```

### File: `src/hooks/atlas/index.test.ts` (additions to session.idle section)

```typescript
test("should handle boulder state without worktree_path gracefully", async () => {
  // given - boulder state with incomplete plan, no worktree_path
  const planPath = join(TEST_DIR, "test-plan.md")
  writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [x] Task 2")

  const state: BoulderState = {
    active_plan: planPath,
    started_at: "2026-01-02T10:00:00Z",
    session_ids: [MAIN_SESSION_ID],
    plan_name: "test-plan",
    // worktree_path intentionally omitted
  }
  writeBoulderState(TEST_DIR, state)

  const mockInput = createMockPluginInput()
  const hook = createAtlasHook(mockInput)

  // when
  await hook.handler({
    event: {
      type: "session.idle",
      properties: { sessionID: MAIN_SESSION_ID },
    },
  })

  // then - should call prompt without crashing, continuation should not contain worktree context
  expect(mockInput._promptMock).toHaveBeenCalled()
  const callArgs = mockInput._promptMock.mock.calls[0][0]
  expect(callArgs.body.parts[0].text).toContain("incomplete tasks")
  expect(callArgs.body.parts[0].text).not.toContain("[Worktree:")
})

test("should include worktree context when worktree_path is present in boulder state", async () => {
  // given - boulder state with worktree_path
  const planPath = join(TEST_DIR, "test-plan.md")
  writeFileSync(planPath, "# Plan\n- [ ] Task 1")

  const state: BoulderState = {
    active_plan: planPath,
    started_at: "2026-01-02T10:00:00Z",
    session_ids: [MAIN_SESSION_ID],
    plan_name: "test-plan",
    worktree_path: "/some/worktree/path",
  }
  writeBoulderState(TEST_DIR, state)

  const mockInput = createMockPluginInput()
  const hook = createAtlasHook(mockInput)

  // when
  await hook.handler({
    event: {
      type: "session.idle",
      properties: { sessionID: MAIN_SESSION_ID },
    },
  })

  // then - should include worktree context in continuation prompt
  expect(mockInput._promptMock).toHaveBeenCalled()
  const callArgs = mockInput._promptMock.mock.calls[0][0]
  expect(callArgs.body.parts[0].text).toContain("[Worktree: /some/worktree/path]")
})
```

---

## Summary of Changes

| File | Change | Lines Modified |
|------|--------|---------------|
| `src/features/boulder-state/storage.ts` | Validate required fields + sanitize worktree_path + guard getPlanProgress | ~8 lines added |
| `src/hooks/atlas/idle-event.ts` | try/catch around setTimeout async callback | ~4 lines added |
| `src/features/boulder-state/storage.test.ts` | 5 new tests for validation | ~60 lines added |
| `src/hooks/atlas/index.test.ts` | 2 new tests for worktree_path handling | ~50 lines added |

Total: ~4 production lines changed, ~8 defensive lines added, ~110 test lines added.
