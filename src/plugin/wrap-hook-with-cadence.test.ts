import { describe, expect, test, mock } from "bun:test"
import { wrapHookWithCadence } from "./wrap-hook-with-cadence"
import { HookCadenceTracker } from "./hook-cadence-tracker"

describe("wrapHookWithCadence", () => {
  test("gates chat.message handler by cadence", async () => {
    const tracker = new HookCadenceTracker({ context_injection: 3 })
    const handler = mock(async () => {})

    const hook = wrapHookWithCadence(
      "start-work",
      { "chat.message": handler },
      tracker
    )

    const input = { sessionID: "s1" }

    await hook["chat.message"](input) // Turn 1: fires
    await hook["chat.message"](input) // Turn 2: skipped
    await hook["chat.message"](input) // Turn 3: skipped
    await hook["chat.message"](input) // Turn 4: fires

    expect(handler).toHaveBeenCalledTimes(2)
  })

  test("gates chat.params handler by cadence", async () => {
    const tracker = new HookCadenceTracker({ reminders: 3 })
    const handler = mock(async () => {})

    const hook = wrapHookWithCadence(
      "anthropic-effort",
      { "chat.params": handler },
      tracker
    )

    const input = { sessionID: "s1" }

    await hook["chat.params"](input) // Turn 1: fires
    await hook["chat.params"](input) // Turn 2: skipped
    await hook["chat.params"](input) // Turn 3: skipped
    await hook["chat.params"](input) // Turn 4: fires

    expect(handler).toHaveBeenCalledTimes(2)
  })

  test("gates tool.execute.before handler by cadence", async () => {
    const tracker = new HookCadenceTracker({ tool_guidance: 2 })
    const handler = mock(async () => {})

    const hook = wrapHookWithCadence(
      "agent-usage-reminder",
      { "tool.execute.before": handler },
      tracker
    )

    const input = { sessionID: "s1" }

    await hook["tool.execute.before"](input) // Turn 1: fires
    await hook["tool.execute.before"](input) // Turn 2: skipped
    await hook["tool.execute.before"](input) // Turn 3: fires

    expect(handler).toHaveBeenCalledTimes(2)
  })

  test("event handler always passes through (not cadence-gated)", async () => {
    const tracker = new HookCadenceTracker({ error_recovery: 3 })
    const handler = mock(async () => {})

    const hook = wrapHookWithCadence(
      "edit-error-recovery",
      { event: handler },
      tracker
    )

    const input = { event: { type: "session.error" } }

    await hook.event(input)
    await hook.event(input)
    await hook.event(input)

    expect(handler).toHaveBeenCalledTimes(3)
  })

  test("session cleanup events pass through and clean up tracker", async () => {
    const tracker = new HookCadenceTracker({ context_injection: 3 })
    const handler = mock(async () => {})

    const hook = wrapHookWithCadence(
      "rules-injector",
      { event: handler },
      tracker
    )

    // Build up state
    tracker.shouldFire("rules-injector", "s1")
    expect(tracker.getTurnCount("rules-injector", "s1")).toBe(1)

    // session.deleted should pass through AND clean up
    await hook.event({
      event: {
        type: "session.deleted",
        properties: { info: { id: "s1" } },
      },
    })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(tracker.getTurnCount("rules-injector", "s1")).toBe(0)
  })

  test("handler without sessionID passes through ungated", async () => {
    const tracker = new HookCadenceTracker({ context_injection: 3 })
    const handler = mock(async () => {})

    const hook = wrapHookWithCadence(
      "rules-injector",
      { "chat.message": handler },
      tracker
    )

    // Input without sessionID — should always fire (safety fallback)
    await hook["chat.message"]({})
    await hook["chat.message"]({})
    await hook["chat.message"]({})

    expect(handler).toHaveBeenCalledTimes(3)
  })
})
