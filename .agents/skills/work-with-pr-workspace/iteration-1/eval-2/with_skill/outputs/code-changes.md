# Code Changes

## File 1: `src/features/boulder-state/storage.ts`

**Change**: Add `worktree_path` sanitization in `readBoulderState()`

```typescript
// BEFORE (lines 29-32):
    if (!Array.isArray(parsed.session_ids)) {
      parsed.session_ids = []
    }
    return parsed as BoulderState

// AFTER:
    if (!Array.isArray(parsed.session_ids)) {
      parsed.session_ids = []
    }
    if (parsed.worktree_path !== undefined && typeof parsed.worktree_path !== "string") {
      parsed.worktree_path = undefined
    }
    return parsed as BoulderState
```

**Rationale**: `readBoulderState` casts raw `JSON.parse()` output as `BoulderState` without validating individual fields. When boulder.json has `"worktree_path": null` (valid JSON from manual edits, corrupted state, or external tools), the runtime type is `null` but TypeScript type says `string | undefined`. This sanitization ensures downstream code always gets the correct type.

---

## File 2: `src/hooks/atlas/idle-event.ts`

**Change**: Add defensive string type guard before passing `worktree_path` to continuation functions.

```typescript
// BEFORE (lines 83-88 in scheduleRetry):
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

// AFTER:
      await injectContinuation({
        ctx,
        sessionID,
        sessionState,
        options,
        planName: currentBoulder.plan_name,
        progress: currentProgress,
        agent: currentBoulder.agent,
        worktreePath: typeof currentBoulder.worktree_path === "string" ? currentBoulder.worktree_path : undefined,
      })
```

```typescript
// BEFORE (lines 184-188 in handleAtlasSessionIdle):
  await injectContinuation({
    ctx,
    sessionID,
    sessionState,
    options,
    planName: boulderState.plan_name,
    progress,
    agent: boulderState.agent,
    worktreePath: boulderState.worktree_path,
  })

// AFTER:
  await injectContinuation({
    ctx,
    sessionID,
    sessionState,
    options,
    planName: boulderState.plan_name,
    progress,
    agent: boulderState.agent,
    worktreePath: typeof boulderState.worktree_path === "string" ? boulderState.worktree_path : undefined,
  })
```

**Rationale**: Belt-and-suspenders defense. Even though `readBoulderState` now sanitizes, direct `writeBoulderState` calls elsewhere could still produce invalid state. The `typeof` check is zero-cost and prevents any possibility of `null` or non-string values leaking through.

---

## File 3: `src/hooks/atlas/index.test.ts`

**Change**: Add test cases for missing `worktree_path` scenarios within the existing `session.idle handler` describe block.

```typescript
    test("should inject continuation when boulder.json has no worktree_path field", async () => {
      // given - boulder state WITHOUT worktree_path
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [x] Task 2")

      const state: BoulderState = {
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "test-plan",
      }
      writeBoulderState(TEST_DIR, state)

      const readState = readBoulderState(TEST_DIR)
      expect(readState?.worktree_path).toBeUndefined()

      const mockInput = createMockPluginInput()
      const hook = createAtlasHook(mockInput)

      // when
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // then - continuation injected, no worktree context in prompt
      expect(mockInput._promptMock).toHaveBeenCalled()
      const callArgs = mockInput._promptMock.mock.calls[0][0]
      expect(callArgs.body.parts[0].text).not.toContain("[Worktree:")
      expect(callArgs.body.parts[0].text).toContain("1 remaining")
    })

    test("should handle boulder.json with worktree_path: null without crashing", async () => {
      // given - manually write boulder.json with worktree_path: null (corrupted state)
      const planPath = join(TEST_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [x] Task 2")

      const boulderPath = join(SISYPHUS_DIR, "boulder.json")
      writeFileSync(boulderPath, JSON.stringify({
        active_plan: planPath,
        started_at: "2026-01-02T10:00:00Z",
        session_ids: [MAIN_SESSION_ID],
        plan_name: "test-plan",
        worktree_path: null,
      }, null, 2))

      const mockInput = createMockPluginInput()
      const hook = createAtlasHook(mockInput)

      // when
      await hook.handler({
        event: {
          type: "session.idle",
          properties: { sessionID: MAIN_SESSION_ID },
        },
      })

      // then - should inject continuation without crash, no "[Worktree: null]"
      expect(mockInput._promptMock).toHaveBeenCalled()
      const callArgs = mockInput._promptMock.mock.calls[0][0]
      expect(callArgs.body.parts[0].text).not.toContain("[Worktree: null]")
      expect(callArgs.body.parts[0].text).not.toContain("[Worktree: undefined]")
    })
```

---

## File 4: `src/features/boulder-state/storage.test.ts` (addition to existing)

**Change**: Add `readBoulderState` sanitization test.

```typescript
  describe("#given boulder.json with worktree_path: null", () => {
    test("#then readBoulderState should sanitize null to undefined", () => {
      // given
      const boulderPath = join(TEST_DIR, ".sisyphus", "boulder.json")
      writeFileSync(boulderPath, JSON.stringify({
        active_plan: "/path/to/plan.md",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "test-plan",
        worktree_path: null,
      }, null, 2))

      // when
      const state = readBoulderState(TEST_DIR)

      // then
      expect(state).not.toBeNull()
      expect(state!.worktree_path).toBeUndefined()
    })

    test("#then readBoulderState should preserve valid worktree_path string", () => {
      // given
      const boulderPath = join(TEST_DIR, ".sisyphus", "boulder.json")
      writeFileSync(boulderPath, JSON.stringify({
        active_plan: "/path/to/plan.md",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        plan_name: "test-plan",
        worktree_path: "/valid/worktree/path",
      }, null, 2))

      // when
      const state = readBoulderState(TEST_DIR)

      // then
      expect(state?.worktree_path).toBe("/valid/worktree/path")
    })
  })
```
