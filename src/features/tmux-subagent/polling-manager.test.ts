import { describe, test, expect } from "bun:test"
import { TmuxPollingManager } from "./polling-manager"
import type { TrackedSession } from "./types"

describe("TmuxPollingManager overlap", () => {
  test("skips overlapping pollSessions executions", async () => {
    //#given
    const sessions = new Map<string, TrackedSession>()
    sessions.set("ses-1", {
      sessionId: "ses-1",
      paneId: "%1",
      description: "test",
      createdAt: new Date(),
      lastSeenAt: new Date(),
      closePending: false,
      closeRetryCount: 0,
    })

    let activeCalls = 0
    let maxActiveCalls = 0
    let statusCallCount = 0
    let releaseStatus: (() => void) | undefined
    const statusGate = new Promise<void>((resolve) => {
      releaseStatus = resolve
    })

    const client = {
      session: {
        status: async () => {
          statusCallCount += 1
          activeCalls += 1
          maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
          await statusGate
          activeCalls -= 1
          return { data: { "ses-1": { type: "running" } } }
        },
        messages: async () => ({ data: [] }),
      },
    }

    const manager = new TmuxPollingManager(
      client as unknown as import("../../tools/delegate-task/types").OpencodeClient,
      sessions,
      async () => {},
    )

    //#when
    const firstPoll = (manager as unknown as { pollSessions: () => Promise<void> }).pollSessions()
    await Promise.resolve()
    const secondPoll = (manager as unknown as { pollSessions: () => Promise<void> }).pollSessions()
    releaseStatus?.()
    await Promise.all([firstPoll, secondPoll])

    //#then
    expect(maxActiveCalls).toBe(1)
    expect(statusCallCount).toBe(1)
  })

  test("closes stable idle sessions without fetching full messages when activity was already observed from events", async () => {
    //#given
    const sessions = new Map<string, TrackedSession>()
    sessions.set("ses-1", {
      sessionId: "ses-1",
      paneId: "%1",
      description: "test",
      createdAt: new Date(Date.now() - 15_000),
      lastSeenAt: new Date(),
      closePending: false,
      closeRetryCount: 0,
      activityVersion: 0,
    })

    let messagesCallCount = 0
    const closedSessionIds: string[] = []
    const client = {
      session: {
        status: async () => ({ data: { "ses-1": { type: "idle" } } }),
        messages: async () => {
          messagesCallCount += 1
          return { data: [] }
        },
      },
    }

    const manager = new TmuxPollingManager(
      client as unknown as import("../../tools/delegate-task/types").OpencodeClient,
      sessions,
      async (sessionId) => {
        closedSessionIds.push(sessionId)
      },
    )

    manager.handleEvent({
      type: "message.part.delta",
      properties: { sessionID: "ses-1", field: "text", delta: "done" },
    })

    //#when
    const pollSessions = (manager as unknown as { pollSessions: () => Promise<void> }).pollSessions
    await pollSessions.call(manager)
    await pollSessions.call(manager)
    await pollSessions.call(manager)
    await pollSessions.call(manager)

    //#then
    expect(messagesCallCount).toBe(0)
    expect(closedSessionIds).toEqual(["ses-1"])
  })
})
