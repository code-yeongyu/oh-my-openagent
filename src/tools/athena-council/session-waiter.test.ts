/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { BackgroundManager } from "../../features/background-agent"
import { waitForCouncilSessions } from "./session-waiter"

describe("waitForCouncilSessions", () => {
  test("resolves all sessions when tasks have sessionIDs immediately", async () => {
    //#given
    const launched = [
      { member: { model: "openai/gpt-5.3-codex", name: "GPT" }, taskId: "task-1" },
      { member: { model: "anthropic/claude-opus-4-6" }, taskId: "task-2" },
    ]
    const manager = {
      getTask: (id: string) => ({ sessionID: `ses-${id}` }),
    } as unknown as BackgroundManager

    //#when
    const result = await waitForCouncilSessions(launched, manager)

    //#then
    expect(result.sessions).toHaveLength(2)
    expect(result.timedOut).toBe(false)
    expect(result.aborted).toBe(false)
    expect(result.sessions[0].taskId).toBe("task-1")
    expect(result.sessions[0].memberName).toBe("GPT")
    expect(result.sessions[1].taskId).toBe("task-2")
    expect(result.sessions[1].memberName).toBe("anthropic/claude-opus-4-6")
  })

  test("returns empty sessions for empty launched list", async () => {
    //#given
    const manager = { getTask: () => undefined } as unknown as BackgroundManager

    //#when
    const result = await waitForCouncilSessions([], manager)

    //#then
    expect(result.sessions).toHaveLength(0)
    expect(result.timedOut).toBe(false)
    expect(result.aborted).toBe(false)
  })

  test("sets aborted flag when abort signal fires", async () => {
    //#given
    const launched = [
      { member: { model: "openai/gpt-5.3-codex" }, taskId: "task-1" },
    ]
    const manager = { getTask: () => undefined } as unknown as BackgroundManager
    const controller = new AbortController()
    // Abort immediately
    controller.abort()

    //#when
    const result = await waitForCouncilSessions(launched, manager, controller.signal)

    //#then
    expect(result.sessions).toHaveLength(0)
    expect(result.aborted).toBe(true)
    expect(result.timedOut).toBe(false)
  })

  test("resolves partial sessions when some tasks get sessionIDs", async () => {
    //#given
    const launched = [
      { member: { model: "openai/gpt-5.3-codex", name: "GPT" }, taskId: "task-1" },
      { member: { model: "anthropic/claude-opus-4-6" }, taskId: "task-2" },
    ]
    const controller = new AbortController()
    let callCount = 0
    const manager = {
      getTask: (id: string) => {
        callCount++
        // Only task-1 gets a session, task-2 never does
        if (id === "task-1") return { sessionID: "ses-task-1" }
        return undefined
      },
    } as unknown as BackgroundManager

    // Abort after a short delay to avoid waiting full 30s
    setTimeout(() => controller.abort(), 200)

    //#when
    const result = await waitForCouncilSessions(launched, manager, controller.signal)

    //#then
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].taskId).toBe("task-1")
    expect(result.aborted).toBe(true)
  })

  test("uses member model as memberName when name is not provided", async () => {
    //#given
    const launched = [
      { member: { model: "google/gemini-3-pro" }, taskId: "task-1" },
    ]
    const manager = {
      getTask: () => ({ sessionID: "ses-1" }),
    } as unknown as BackgroundManager

    //#when
    const result = await waitForCouncilSessions(launched, manager)

    //#then
    expect(result.sessions[0].memberName).toBe("google/gemini-3-pro")
    expect(result.sessions[0].model).toBe("google/gemini-3-pro")
  })
})
