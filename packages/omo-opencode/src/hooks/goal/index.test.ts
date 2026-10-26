import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { createGoalHook } from "./index"

function makePluginInput(): PluginInput {
  return {
    directory: mkdtempSync(join(tmpdir(), "goal-hook-")),
    client: {
      session: {
        messages: {
          create: async () => ({ id: "msg-1" }),
        },
      },
    },
  } as unknown as PluginInput
}

describe("createGoalHook", () => {
  test("setGoal and getGoal round trip", () => {
    const ctx = makePluginInput()
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })

    const goal = hook.setGoal("s1", "Ship it")

    expect(goal.objective).toBe("Ship it")
    expect(hook.getGoal("s1")?.objective).toBe("Ship it")
  })

  test("clearGoal removes goal", () => {
    const ctx = makePluginInput()
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal("s1", "Ship it")

    hook.clearGoal("s1")

    expect(hook.getGoal("s1")).toBeNull()
  })

  test("session.deleted clears goal", async () => {
    const ctx = makePluginInput()
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal("s1", "Ship it")

    await hook.event({ event: { type: "session.deleted", properties: { sessionID: "s1" } } })

    expect(hook.getGoal("s1")).toBeNull()
  })

  test("session.idle pauses goal at budget", async () => {
    const ctx = makePluginInput()
    const hook = createGoalHook(ctx, { projectDir: ctx.directory, maxIterations: 1 })
    hook.setGoal("s1", "Ship it")
    await hook.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })
    expect(hook.getGoal("s1")?.status).toBe("active")
    await hook.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })
    expect(hook.getGoal("s1")?.status).toBe("paused")
    expect(hook.getGoal("s1")?.pauseReason).toBe("budget")
  })

  test("session.error stalls then pauses", async () => {
    const ctx = makePluginInput()
    const hook = createGoalHook(ctx, { projectDir: ctx.directory, maxStalls: 2 })
    hook.setGoal("s1", "Ship it")
    await hook.event({ event: { type: "session.error", properties: { sessionID: "s1" } } })
    expect(hook.getGoal("s1")?.status).toBe("active")
    expect(hook.getGoal("s1")?.stallCount).toBe(1)
    await hook.event({ event: { type: "session.error", properties: { sessionID: "s1" } } })
    expect(hook.getGoal("s1")?.status).toBe("paused")
    expect(hook.getGoal("s1")?.pauseReason).toBe("stalled")
  })

  test("session.idle resets stall count", async () => {
    const ctx = makePluginInput()
    const hook = createGoalHook(ctx, { projectDir: ctx.directory, maxStalls: 5 })
    hook.setGoal("s1", "Ship it")
    await hook.event({ event: { type: "session.error", properties: { sessionID: "s1" } } })
    expect(hook.getGoal("s1")?.stallCount).toBe(1)
    await hook.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })
    expect(hook.getGoal("s1")?.stallCount).toBe(0)
  })

  test("session.compacted re-injects for active goal", async () => {
    const ctx = makePluginInput()
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal("s1", "Ship it")
    await hook.event({ event: { type: "session.compacted", properties: { sessionID: "s1" } } })
    expect(hook.getGoal("s1")?.status).toBe("active")
  })

  test("session.idle injects continuation for active goal", async () => {
    const ctx = makePluginInput()
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal("s1", "Ship it")

    await hook.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })

    // No crash; injection is best-effort.
    expect(hook.getGoal("s1")?.status).toBe("active")
  })

  test("session.idle skips paused goal", async () => {
    const ctx = makePluginInput()
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal("s1", "Ship it")
    hook.pauseGoal("s1")

    await hook.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })

    expect(hook.getGoal("s1")?.status).toBe("paused")
  })

  test("event without sessionID is ignored", async () => {
    const ctx = makePluginInput()
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal("s1", "Ship it")

    await hook.event({ event: { type: "session.idle", properties: {} } })

    expect(hook.getGoal("s1")?.status).toBe("active")
  })
})
