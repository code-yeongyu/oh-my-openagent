/// <reference types="bun-types" />

import { describe, test, expect, afterEach, beforeEach } from "bun:test"
import { clearPromptReservationsForTesting } from "@oh-my-opencode/utils/prompt-async-gate/reservations"
import { clearRecentPromptDispatchesForTesting } from "@oh-my-opencode/utils/prompt-async-gate/recent-dispatches"
import { BackgroundManager } from "./manager"
import { handleSessionIdleBackgroundEvent } from "./session-idle-event-handler"
import type { BackgroundTask } from "./types"
import { MIN_RUNTIME_BEFORE_STALE_MS } from "./constants"
import { createManagerWithMessages, createCompletedTask, previousRunMessages, resumeInput } from "./resume-anchor-test-fixture"

let managers: BackgroundManager[] = []

function track(manager: BackgroundManager): BackgroundManager {
  managers.push(manager)
  return manager
}

beforeEach(() => {
  clearPromptReservationsForTesting()
  clearRecentPromptDispatchesForTesting()
})

afterEach(async () => {
  for (const manager of managers) {
    await manager.shutdown()
  }
  managers = []
})

describe("BackgroundManager resume completion anchor", () => {
  test.each([
    ["rejects", () => Promise.reject(new TypeError("unavailable"))],
    ["returns an error envelope", async () => ({ error: { name: "UnknownError" } })],
  ])("restores the completed task without dispatch when capture %s", async (_label, read) => {
    //#given
    const { manager, client, prompts } = createManagerWithMessages(previousRunMessages())
    track(manager)
    const task = createCompletedTask()
    manager["tasks"].set(task.id, task)
    client.session.messages = read
    //#when
    await manager.resume(resumeInput)
    //#then
    expect(task.status).toBe("completed")
    expect(task.concurrencyKey).toBeUndefined()
    expect(prompts).toHaveLength(0)
  })

  test.each(["cancel", "shutdown"] as const)("does not dispatch after %s during capture", async (action) => {
    //#given
    const { manager, client, prompts } = createManagerWithMessages(previousRunMessages())
    track(manager)
    const task = createCompletedTask()
    manager["tasks"].set(task.id, task)
    const pending = Promise.withResolvers<unknown>()
    const entered = Promise.withResolvers<void>()
    client.session.messages = () => { entered.resolve(); return pending.promise }
    const resume = manager.resume(resumeInput)
    await entered.promise
    //#when
    switch (action) {
      case "cancel": await manager.cancelTask(task.id); break
      case "shutdown": await manager.shutdown(); break
    }
    pending.resolve({ data: previousRunMessages() })
    await resume
    //#then
    expect(prompts).toHaveLength(0)
    expect(manager["pollingInterval"]).toBeUndefined()
  })

  test("does not complete when only the continuation user message has arrived", async () => {
    //#given
    const messages = previousRunMessages()
    const { manager, aborts } = createManagerWithMessages(messages, { appendOnPrompt: true })
    track(manager)
    const task = createCompletedTask()
    manager["tasks"].set(task.id, task)
    manager["observedOutputSessions"].add(resumeInput.sessionId)
    await manager.resume(resumeInput)
    messages.push({ info: { id: "msg_continue", role: "user" }, parts: [{ type: "text", text: "continue" }] })
    //#when
    await manager["pollRunningTasks"]()
    //#then
    expect(task.status).toBe("running")
    expect(aborts).toHaveLength(0)
  })

  test("rechecks idle after reading resumed output", async () => {
    //#given
    const messages = previousRunMessages()
    const { manager, client, aborts, submitted } = createManagerWithMessages(messages)
    track(manager)
    const task = createCompletedTask()
    manager["tasks"].set(task.id, task)
    await manager.resume(resumeInput)
    await submitted
    messages.push({ info: { id: "msg_new", role: "assistant" }, parts: [{ type: "text", text: "working" }] })
    client.session.messages = async () => {
      client.session.status = async () => ({ data: { ses_bg_anchor: { type: "busy" } } })
      return { data: messages }
    }
    //#when
    await manager["pollRunningTasks"]()
    //#then
    expect(task.status).toBe("running")
    expect(aborts).toHaveLength(0)
  })

  test.each([
    ["rejects", () => Promise.reject(new TypeError("messages unavailable"))],
    ["returns an SDK error", async () => ({ error: { name: "UnknownError", data: { message: "messages unavailable" } } })],
  ])("poller keeps the continuation running when the post-resume read %s", async (_label, readMessages) => {
    //#given
    const { manager, aborts, client, submitted } = createManagerWithMessages(previousRunMessages())
    track(manager)
    const task = createCompletedTask()
    manager["tasks"].set(task.id, task)
    manager["observedOutputSessions"].add(resumeInput.sessionId)
    await manager.resume(resumeInput)
    await submitted
    client.session.messages = readMessages

    //#when
    await manager["pollRunningTasks"]()

    //#then
    expect(task.status).toBe("running")
    expect(aborts).toHaveLength(0)
  })

  test("poller completes after a failed message read recovers with new output", async () => {
    //#given
    const messages = previousRunMessages()
    const { manager, client, submitted } = createManagerWithMessages(messages)
    track(manager)
    const task = createCompletedTask()
    manager["tasks"].set(task.id, task)
    manager["observedOutputSessions"].add(resumeInput.sessionId)
    await manager.resume(resumeInput)
    await submitted
    const readMessages = client.session.messages
    client.session.messages = async () => ({ error: { name: "UnknownError" } })
    await manager["pollRunningTasks"]()
    client.session.messages = readMessages
    messages.push({ info: { id: "msg_recovered", role: "assistant" }, parts: [{ type: "text", text: "new output" }] })

    //#when
    await manager["pollRunningTasks"]()

    //#then
    expect(task.status).toBe("completed")
  })

  test("poller cancels an unadvanced continuation through the existing stale timeout", async () => {
    //#given
    const config = { staleTimeoutMs: 60_000 }
    const { manager, client, aborts, submitted } = createManagerWithMessages(previousRunMessages(), { config })
    track(manager)
    const task = createCompletedTask()
    manager["tasks"].set(task.id, task)
    await manager.resume(resumeInput)
    await submitted
    client.session.messages = async () => ({ error: { name: "UnknownError" } })
    task.startedAt = new Date(Date.now() - MIN_RUNTIME_BEFORE_STALE_MS - 1)
    task.progress = { toolCalls: 0, lastUpdate: new Date(Date.now() - config.staleTimeoutMs - 1) }

    //#when
    await manager["pollRunningTasks"]()

    //#then
    expect(task.status).toBe("cancelled")
    expect(aborts).toHaveLength(1)
  })

  test("poller does not re-complete a resumed task on the previous run's output", async () => {
    //#given
    const messages = previousRunMessages()
    const { manager, aborts, submitted } = createManagerWithMessages(messages)
    track(manager)
    const task = createCompletedTask()
    manager["tasks"].set(task.id, task)
    // The previous run's part events marked this session's output observed, so
    // validateSessionHasOutput short-circuits true on the cached entry.
    manager["observedOutputSessions"].add(task.sessionId!)

    //#when
    const resumed = await manager.resume(resumeInput)
    await submitted
    expect(resumed.status).toBe("running")
    expect(resumed.resumeAnchor).toEqual({ anchorMessageCount: 2, anchorMessageID: "msg_prev_answer", capturedMessageIDs: ["msg_launch", "msg_prev_answer"] })
    // The continuation prompt has not landed yet; the previous run's output is
    // still all the session contains.
    await manager["pollRunningTasks"]()

    //#then
    expect(task.status).toBe("running")
    expect(aborts).toHaveLength(0)
  })

  test("resumed task completes once a new turn exists after the anchor", async () => {
    //#given
    const messages = previousRunMessages()
    const { manager, aborts, submitted } = createManagerWithMessages(messages)
    track(manager)
    const task = createCompletedTask()
    manager["tasks"].set(task.id, task)
    manager["observedOutputSessions"].add(task.sessionId!)

    //#when
    await manager.resume(resumeInput)
    await submitted
    // The continuation turn ran and produced a new assistant message.
    messages.push({
      info: { id: "msg_new_answer", role: "assistant" },
      parts: [{ type: "text", text: "continuation answer" }],
    })
    await manager["pollRunningTasks"]()

    //#then
    expect(task.status).toBe("completed")
    expect(task.resumeAnchor).toBeUndefined()
    expect(aborts).toHaveLength(1)
  })

  test("session.idle handler waits for a message after the resume anchor", async () => {
    //#given
    const messages = previousRunMessages()
    const { manager } = createManagerWithMessages(messages)
    track(manager)
    const task = createCompletedTask()
    task.status = "running"
    task.startedAt = new Date(Date.now() - 60_000)
    task.resumeAnchor = { anchorMessageCount: 2, anchorMessageID: "msg_prev_answer" }
    manager["tasks"].set(task.id, task)
    const completions: string[] = []
    const deps = {
      properties: { sessionID: task.sessionId },
      findBySession: () => task,
      idleDeferralTimers: new Map(),
      validateSessionHasOutput: () => manager["validateSessionHasOutput"](task.sessionId!),
      sessionHasMessagesAfterAnchor: (sessionID: string, candidate: BackgroundTask) =>
        manager["sessionHasMessagesAfterAnchor"](sessionID, candidate),
      checkSessionTodos: () => manager["checkSessionTodos"](task.sessionId!),
      tryCompleteTask: (candidate: BackgroundTask, source: string) => {
        completions.push(source)
        return manager["tryCompleteTask"](candidate, source)
      },
      emitIdleEvent: () => {},
    }

    //#when
    handleSessionIdleBackgroundEvent(deps)
    await new Promise((resolve) => setTimeout(resolve, 30))

    //#then
    expect(completions).toHaveLength(0)
    expect(task.status).toBe("running")

    //#when
    messages.push({
      info: { id: "msg_new_answer", role: "assistant" },
      parts: [{ type: "text", text: "continuation answer" }],
    })
    handleSessionIdleBackgroundEvent(deps)
    await new Promise((resolve) => setTimeout(resolve, 30))

    //#then
    expect(completions).toHaveLength(1)
    expect(manager.getTask(task.id)?.status).toBe("completed")
  })
})
