import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { createGoalHook, shouldActivateUltrawork } from "./index"

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

  test("shouldActivateUltrawork activates once per goal and only when enabled", () => {
    const activated = new Set<string>()
    expect(shouldActivateUltrawork(true, "g1", activated)).toBe(true)
    activated.add("g1")
    expect(shouldActivateUltrawork(true, "g1", activated)).toBe(false)
    expect(shouldActivateUltrawork(true, "g2", activated)).toBe(true)
    expect(shouldActivateUltrawork(false, "g3", new Set())).toBe(false)
    expect(shouldActivateUltrawork(undefined, "g4", new Set())).toBe(false)
  })

  test("goal.ultrawork frames the first continuation with the ultrawork prompt", async () => {
    const captured: string[] = []
    const directory = mkdtempSync(join(tmpdir(), "goal-hook-"))
    const ctx = {
      directory,
      client: {
        session: {
          messages: { create: async () => ({ id: "m" }) },
          promptAsync: async (input: { body?: { parts?: Array<{ text?: string }> } }) => {
            const text = input?.body?.parts?.[0]?.text
            if (typeof text === "string") captured.push(text)
            return { status: "ok" }
          },
        },
      },
    } as unknown as PluginInput
    const hook = createGoalHook(ctx, { projectDir: directory, ultrawork: true })
    hook.setGoal("s1", "Ship it")

    await hook.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })

    expect(captured[0]?.startsWith("<ultrawork-mode>")).toBe(true)
    expect(captured[0]).toContain("Continue working toward the active thread goal")
  })

  test("without goal.ultrawork the continuation is plain", async () => {
    const captured: string[] = []
    const directory = mkdtempSync(join(tmpdir(), "goal-hook-"))
    const ctx = {
      directory,
      client: {
        session: {
          messages: { create: async () => ({ id: "m" }) },
          promptAsync: async (input: { body?: { parts?: Array<{ text?: string }> } }) => {
            const text = input?.body?.parts?.[0]?.text
            if (typeof text === "string") captured.push(text)
            return { status: "ok" }
          },
        },
      },
    } as unknown as PluginInput
    const hook = createGoalHook(ctx, { projectDir: directory, ultrawork: false })
    hook.setGoal("s1", "Ship it")

    await hook.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })

    expect(captured[0]?.startsWith("Continue working toward the active thread goal")).toBe(true)
    expect(captured[0]).not.toContain("<ultrawork-mode>")
  })
})
