import { describe, expect, test } from "bun:test"
import { HookCadenceTracker } from "./hook-cadence-tracker"

describe("HookCadenceTracker", () => {
  test("default cadence of 1 fires every turn", () => {
    const tracker = new HookCadenceTracker()
    const sessionID = "test-session"
    const hookName = "agent-usage-reminder"

    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)
  })

  test("cadence of 3 fires on turns 1, 4, 7, 10", () => {
    const tracker = new HookCadenceTracker({ "agent-usage-reminder": 3 })
    const sessionID = "test-session"
    const hookName = "agent-usage-reminder"

    // Turn 1: should fire
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)
    expect(tracker.getTurnCount(hookName, sessionID)).toBe(1)

    // Turns 2-3: should not fire
    expect(tracker.shouldFire(hookName, sessionID)).toBe(false)
    expect(tracker.shouldFire(hookName, sessionID)).toBe(false)

    // Turn 4: should fire
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)
    expect(tracker.getTurnCount(hookName, sessionID)).toBe(4)

    // Turns 5-6: should not fire
    expect(tracker.shouldFire(hookName, sessionID)).toBe(false)
    expect(tracker.shouldFire(hookName, sessionID)).toBe(false)

    // Turn 7: should fire
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)
  })

  test("cadence of 5 fires on turns 1, 6, 11", () => {
    const tracker = new HookCadenceTracker({ "rules-injector": 5 })
    const sessionID = "test-session"
    const hookName = "rules-injector"

    // Turn 1: should fire
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)

    // Turns 2-5: should not fire
    for (let i = 0; i < 4; i++) {
      expect(tracker.shouldFire(hookName, sessionID)).toBe(false)
    }

    // Turn 6: should fire
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)

    // Turns 7-10: should not fire
    for (let i = 0; i < 4; i++) {
      expect(tracker.shouldFire(hookName, sessionID)).toBe(false)
    }

    // Turn 11: should fire
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)
  })

  test("different hooks have independent counters", () => {
    const tracker = new HookCadenceTracker({
      "agent-usage-reminder": 2,
      "rules-injector": 3,
    })
    const sessionID = "test-session"

    // Hook 1 with cadence 2: fires on 1, 3, 5
    expect(tracker.shouldFire("agent-usage-reminder", sessionID)).toBe(true)
    expect(tracker.shouldFire("agent-usage-reminder", sessionID)).toBe(false)
    expect(tracker.shouldFire("agent-usage-reminder", sessionID)).toBe(true)

    // Hook 2 with cadence 3: fires on 1, 4, 7
    expect(tracker.shouldFire("rules-injector", sessionID)).toBe(true)
    expect(tracker.shouldFire("rules-injector", sessionID)).toBe(false)
    expect(tracker.shouldFire("rules-injector", sessionID)).toBe(false)
    expect(tracker.shouldFire("rules-injector", sessionID)).toBe(true)
  })

  test("different sessions have independent counters", () => {
    const tracker = new HookCadenceTracker({ "agent-usage-reminder": 2 })
    const hookName = "agent-usage-reminder"

    // Session 1
    expect(tracker.shouldFire(hookName, "session-1")).toBe(true) // Turn 1
    expect(tracker.shouldFire(hookName, "session-1")).toBe(false) // Turn 2

    // Session 2 starts fresh
    expect(tracker.shouldFire(hookName, "session-2")).toBe(true) // Turn 1
    expect(tracker.shouldFire(hookName, "session-2")).toBe(false) // Turn 2

    // Session 1 continues
    expect(tracker.shouldFire(hookName, "session-1")).toBe(true) // Turn 3
  })

  test("cleanupSession removes session counters", () => {
    const tracker = new HookCadenceTracker({ "agent-usage-reminder": 2 })
    const sessionID = "test-session"
    const hookName = "agent-usage-reminder"

    // Build up some state
    tracker.shouldFire(hookName, sessionID)
    tracker.shouldFire(hookName, sessionID)
    expect(tracker.getTurnCount(hookName, sessionID)).toBe(2)

    // Clean up
    tracker.cleanupSession(sessionID)
    expect(tracker.getTurnCount(hookName, sessionID)).toBe(0)

    // Next call starts fresh
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)
    expect(tracker.getTurnCount(hookName, sessionID)).toBe(1)
  })

  test("hook without configured cadence defaults to 1", () => {
    const tracker = new HookCadenceTracker({ "agent-usage-reminder": 3 })
    const sessionID = "test-session"
    const hookName = "rules-injector" // Not in config

    // Should fire every turn (default cadence = 1)
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)
  })

  test("empty config behaves like no cadence control", () => {
    const tracker = new HookCadenceTracker({})
    const sessionID = "test-session"

    expect(tracker.shouldFire("agent-usage-reminder", sessionID)).toBe(true)
    expect(tracker.shouldFire("rules-injector", sessionID)).toBe(true)
    expect(tracker.shouldFire("think-mode", sessionID)).toBe(true)
  })

  test("undefined config behaves like no cadence control", () => {
    const tracker = new HookCadenceTracker(undefined)
    const sessionID = "test-session"

    expect(tracker.shouldFire("agent-usage-reminder", sessionID)).toBe(true)
    expect(tracker.shouldFire("rules-injector", sessionID)).toBe(true)
  })
})
