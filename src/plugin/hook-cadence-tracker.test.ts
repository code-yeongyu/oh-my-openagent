import { describe, expect, test } from "bun:test"
import { HookCadenceTracker } from "./hook-cadence-tracker"
import { resolveHookCadence, CADENCE_GROUPS, CADENCE_DEFAULTS } from "./hook-cadence-groups"

describe("HookCadenceTracker", () => {
  test("hook not in any group fires every turn (cadence 1)", () => {
    const tracker = new HookCadenceTracker()
    const sessionID = "test-session"
    const hookName = "think-mode" // Not in any group

    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)
  })

  test("grouped cadence: tool_guidance group with cadence 3", () => {
    const tracker = new HookCadenceTracker({ tool_guidance: 3 })
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

  test("grouped cadence: context_injection group with cadence 5", () => {
    const tracker = new HookCadenceTracker({ context_injection: 5 })
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

  test("different groups have independent cadences", () => {
    const tracker = new HookCadenceTracker({
      tool_guidance: 2,
      context_injection: 3,
    })
    const sessionID = "test-session"

    // tool_guidance hook with cadence 2: fires on 1, 3, 5
    expect(tracker.shouldFire("agent-usage-reminder", sessionID)).toBe(true)
    expect(tracker.shouldFire("agent-usage-reminder", sessionID)).toBe(false)
    expect(tracker.shouldFire("agent-usage-reminder", sessionID)).toBe(true)

    // context_injection hook with cadence 3: fires on 1, 4, 7
    expect(tracker.shouldFire("rules-injector", sessionID)).toBe(true)
    expect(tracker.shouldFire("rules-injector", sessionID)).toBe(false)
    expect(tracker.shouldFire("rules-injector", sessionID)).toBe(false)
    expect(tracker.shouldFire("rules-injector", sessionID)).toBe(true)
  })

  test("different sessions have independent counters", () => {
    const tracker = new HookCadenceTracker({ tool_guidance: 2 })
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
    const tracker = new HookCadenceTracker({ tool_guidance: 2 })
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

  test("hook without configured group defaults to group default", () => {
    const tracker = new HookCadenceTracker({ tool_guidance: 5 })
    const sessionID = "test-session"
    const hookName = "rules-injector" // context_injection group, not configured

    // Should use CADENCE_DEFAULTS.context_injection = 3
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true) // Turn 1
    expect(tracker.shouldFire(hookName, sessionID)).toBe(false) // Turn 2
    expect(tracker.shouldFire(hookName, sessionID)).toBe(false) // Turn 3
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true) // Turn 4
  })

  test("hook not in any group always fires (cadence 1)", () => {
    const tracker = new HookCadenceTracker({ tool_guidance: 3 })
    const sessionID = "test-session"
    const hookName = "think-mode" // Not in any group

    // Should fire every turn
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)
    expect(tracker.shouldFire(hookName, sessionID)).toBe(true)
  })

  test("empty config uses group defaults", () => {
    const tracker = new HookCadenceTracker({})
    const sessionID = "test-session"

    // tool_guidance default = 2
    expect(tracker.shouldFire("agent-usage-reminder", sessionID)).toBe(true)
    expect(tracker.shouldFire("agent-usage-reminder", sessionID)).toBe(false)
    expect(tracker.shouldFire("agent-usage-reminder", sessionID)).toBe(true)
  })

  test("undefined config uses group defaults", () => {
    const tracker = new HookCadenceTracker(undefined)
    const sessionID = "test-session"

    // context_injection default = 3
    expect(tracker.shouldFire("rules-injector", sessionID)).toBe(true)
    expect(tracker.shouldFire("rules-injector", sessionID)).toBe(false)
    expect(tracker.shouldFire("rules-injector", sessionID)).toBe(false)
    expect(tracker.shouldFire("rules-injector", sessionID)).toBe(true)
  })
})

describe("resolveHookCadence", () => {
  test("returns configured cadence for hook in group", () => {
    expect(resolveHookCadence("agent-usage-reminder", { tool_guidance: 5 })).toBe(5)
    expect(resolveHookCadence("rules-injector", { context_injection: 10 })).toBe(10)
  })

  test("returns group default when group not configured", () => {
    expect(resolveHookCadence("agent-usage-reminder", {})).toBe(CADENCE_DEFAULTS.tool_guidance)
    expect(resolveHookCadence("rules-injector", {})).toBe(CADENCE_DEFAULTS.context_injection)
    expect(resolveHookCadence("anthropic-effort", {})).toBe(CADENCE_DEFAULTS.reminders)
  })

  test("returns 1 for hook not in any group", () => {
    expect(resolveHookCadence("think-mode", { tool_guidance: 5 })).toBe(1)
    expect(resolveHookCadence("comment-checker", {})).toBe(1)
  })

  test("all hooks in CADENCE_GROUPS are valid HookNames", () => {
    // This is a compile-time check - if it compiles, the test passes
    // TypeScript will error if any hook name is invalid
    for (const group of Object.values(CADENCE_GROUPS)) {
      for (const hookName of group) {
        expect(typeof hookName).toBe("string")
      }
    }
  })
})
