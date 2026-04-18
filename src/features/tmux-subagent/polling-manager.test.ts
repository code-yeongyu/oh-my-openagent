import { describe, test, expect } from "bun:test"
import { TmuxPollingManager } from "./polling-manager"
import type { TrackedSession, WindowState } from "./types"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"

describe("TmuxPollingManager overlap", () => {
  test("skips overlapping pollSessions executions", async () => {
    //#given
    const sessions = new Map<string, TrackedSession>()
    sessions.set("ses-1", {
      sessionId: "ses-1",
      paneId: "%1",
      description: "test",
      attachActivated: true,
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
      unsafeTestValue<import("../../tools/delegate-task/types").OpencodeClient>(client),
      sessions,
      async () => {},
    )

    //#when
    const firstPoll = (unsafeTestValue<{ pollSessions: () => Promise<void> }>(manager)).pollSessions()
    await Promise.resolve()
    const secondPoll = (unsafeTestValue<{ pollSessions: () => Promise<void> }>(manager)).pollSessions()
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
      attachActivated: true,
      createdAt: new Date(Date.now() - 15_000),
      lastSeenAt: new Date(),
      closePending: false,
      closeRetryCount: 0,
      activityVersion: 0,
      stableIdlePolls: 2,
      observedIdleActivityVersion: 0,
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
      unsafeTestValue<import("../../tools/delegate-task/types").OpencodeClient>(client),
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
    const pollSessions = (unsafeTestValue<{ pollSessions: () => Promise<void> }>(manager)).pollSessions
    await pollSessions.call(manager)
    await pollSessions.call(manager)
    await pollSessions.call(manager)

    //#then
    expect(messagesCallCount).toBe(0)
    expect(closedSessionIds).toEqual(["ses-1"])
  })

  test("does not close sessions missing from one poll until the longer grace window elapses", async () => {
    // given
    const now = Date.now()
    const sessions = new Map<string, TrackedSession>()
    sessions.set("ses-1", {
      sessionId: "ses-1",
      paneId: "%1",
      description: "test",
      attachActivated: true,
      createdAt: new Date(now - 1_000),
      lastSeenAt: new Date(now - 7_000),
      closePending: false,
      closeRetryCount: 0,
      activityVersion: 0,
    })

    const closedSessionIds: string[] = []
    const client = {
      session: {
        status: async () => ({ data: {} }),
        messages: async () => ({ data: [] }),
      },
    }

    const manager = new TmuxPollingManager(
      unsafeTestValue<import("../../tools/delegate-task/types").OpencodeClient>(client),
      sessions,
      async (sessionId) => {
        closedSessionIds.push(sessionId)
      },
    )

    // when
    const pollSessions = (unsafeTestValue<{ pollSessions: () => Promise<void> }>(manager)).pollSessions
    await pollSessions.call(manager)

    // then
    expect(closedSessionIds).toEqual([])
  })

  test("does not time out active sessions after only eleven minutes", async () => {
    // given
    const now = Date.now()
    const sessions = new Map<string, TrackedSession>()
    sessions.set("ses-1", {
      sessionId: "ses-1",
      paneId: "%1",
      description: "test",
      attachActivated: true,
      createdAt: new Date(now - 11 * 60 * 1000),
      lastSeenAt: new Date(now),
      closePending: false,
      closeRetryCount: 0,
      activityVersion: 0,
    })

    const closedSessionIds: string[] = []
    const client = {
      session: {
        status: async () => ({ data: { "ses-1": { type: "running" } } }),
        messages: async () => ({ data: [] }),
      },
    }

    const manager = new TmuxPollingManager(
      unsafeTestValue<import("../../tools/delegate-task/types").OpencodeClient>(client),
      sessions,
      async (sessionId) => {
        closedSessionIds.push(sessionId)
      },
    )

    // when
    const pollSessions = (unsafeTestValue<{ pollSessions: () => Promise<void> }>(manager)).pollSessions
    await pollSessions.call(manager)

    // then
    expect(closedSessionIds).toEqual([])
  })

  test("does not close when activityVersion changes before the idle recheck resolves", async () => {
    // given
    const sessions = new Map<string, TrackedSession>()
    sessions.set("ses-1", {
      sessionId: "ses-1",
      paneId: "%1",
      description: "test",
      attachActivated: true,
      createdAt: new Date(Date.now() - 15_000),
      lastSeenAt: new Date(),
      closePending: false,
      closeRetryCount: 0,
      activityVersion: 0,
    })

    const closedSessionIds: string[] = []
    let statusCallCount = 0
    let manager: TmuxPollingManager

    const client = {
      session: {
        status: async () => {
          statusCallCount += 1
          if (statusCallCount === 2) {
            manager.handleEvent({
              type: "message.part.delta",
              properties: { sessionID: "ses-1", field: "text", delta: "new activity" },
            })
          }

          return { data: { "ses-1": { type: "idle" } } }
        },
        messages: async () => ({ data: [] }),
      },
    }

    manager = new TmuxPollingManager(
      unsafeTestValue<import("../../tools/delegate-task/types").OpencodeClient>(client),
      sessions,
      async (sessionId) => {
        closedSessionIds.push(sessionId)
      },
    )
    const pollSessions = (unsafeTestValue<{ pollSessions: () => Promise<void> }>(manager)).pollSessions

    // when
    await pollSessions.call(manager)

    // then
    expect(closedSessionIds).toEqual([])
  })

  test("activates focused panes once before polling statuses", async () => {
    //#given
    const sessions = new Map<string, TrackedSession>()
    const tracked: TrackedSession = {
      sessionId: "ses-1",
      paneId: "%1",
      description: "test",
      attachActivated: false,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      closePending: false,
      closeRetryCount: 0,
      activityVersion: 0,
    }
    sessions.set("ses-1", tracked)

    const activatedSessionIds: string[] = []
    const client = {
      session: {
        status: async () => ({ data: { "ses-1": { type: "running" } } }),
        messages: async () => ({ data: [] }),
      },
    }
    const windowState: WindowState = {
      windowWidth: 160,
      windowHeight: 48,
      windowActive: true,
      sessionAttached: true,
      mainPane: null,
      agentPanes: [
        { paneId: "%1", width: 80, height: 24, left: 0, top: 0, title: "agent", isActive: true },
      ],
    }
    const manager = new TmuxPollingManager(
      unsafeTestValue<import("../../tools/delegate-task/types").OpencodeClient>(client),
      sessions,
      async () => {},
      undefined,
      async () => windowState,
      async (session) => {
        activatedSessionIds.push(session.sessionId)
        return true
      },
    )
    const pollSessions = unsafeTestValue<{ pollSessions: () => Promise<void> }>(manager).pollSessions

    //#when
    await pollSessions.call(manager)
    await pollSessions.call(manager)

    //#then
    expect(activatedSessionIds).toEqual(["ses-1"])
    expect(tracked.attachActivated).toBe(true)
  })

  test("does not close non-activated panes before focus activation", async () => {
    //#given
    const sessions = new Map<string, TrackedSession>()
    sessions.set("ses-1", {
      sessionId: "ses-1",
      paneId: "%1",
      description: "test",
      attachActivated: false,
      createdAt: new Date(Date.now() - 15_000),
      lastSeenAt: new Date(),
      closePending: false,
      closeRetryCount: 0,
      activityVersion: 0,
      stableIdlePolls: 3,
      observedIdleActivityVersion: 0,
    })

    const closedSessionIds: string[] = []
    const client = {
      session: {
        status: async () => ({ data: { "ses-1": { type: "idle" } } }),
        messages: async () => ({ data: [] }),
      },
    }
    const manager = new TmuxPollingManager(
      unsafeTestValue<import("../../tools/delegate-task/types").OpencodeClient>(client),
      sessions,
      async (sessionId) => {
        closedSessionIds.push(sessionId)
      },
    )
    const pollSessions = unsafeTestValue<{ pollSessions: () => Promise<void> }>(manager).pollSessions

    //#when
    await pollSessions.call(manager)

    //#then
    expect(closedSessionIds).toEqual([])
    expect(sessions.has("ses-1")).toBe(true)
  })

  test("does not close immediately when first status is delayed after focused activation", async () => {
    //#given
    const originalDateNow = Date.now
    let now = 0
    Date.now = () => now

    try {
      const sessions = new Map<string, TrackedSession>()
      const tracked: TrackedSession = {
        sessionId: "ses-1",
        paneId: "%1",
        description: "test",
        attachActivated: false,
        createdAt: new Date(0),
        lastSeenAt: new Date(0),
        closePending: false,
        closeRetryCount: 0,
      }
      sessions.set("ses-1", tracked)

      let activationCount = 0
      let statusCalls = 0
      const closedSessionIds: string[] = []
      const getWindowState = async (): Promise<WindowState> => ({
        windowWidth: 220,
        windowHeight: 44,
        mainPane: { paneId: "%0", width: 110, height: 44, left: 0, top: 0, title: "main", isActive: false },
        agentPanes: [{ paneId: "%1", width: 110, height: 44, left: 110, top: 0, title: "agent", isActive: true }],
      })

      const client = {
        session: {
          status: async () => {
            statusCalls += 1
            now += 3_000
            if (statusCalls <= 3) {
              return { data: {} }
            }
            return { data: { "ses-1": { type: "running" } } }
          },
          messages: async () => ({ data: [] }),
        },
      }

      const manager = new TmuxPollingManager(
        client as unknown as import("../../tools/delegate-task/types").OpencodeClient,
        sessions,
        async (sessionId) => {
          closedSessionIds.push(sessionId)
        },
        getWindowState,
        async () => {
          activationCount += 1
          return true
        },
      )

      //#when
      const pollSessions = (manager as unknown as { pollSessions: () => Promise<void> }).pollSessions
      await pollSessions.call(manager)
      await pollSessions.call(manager)
      await pollSessions.call(manager)
      await pollSessions.call(manager)

      //#then
      expect(activationCount).toBe(1)
      expect(tracked.attachActivated).toBe(true)
      expect(closedSessionIds).toEqual([])
      expect(sessions.has("ses-1")).toBe(true)
    } finally {
      Date.now = originalDateNow
    }
  })

  test("can still close non-activated sessions once status is idle and stable", async () => {
    //#given
    const sessions = new Map<string, TrackedSession>()
    sessions.set("ses-1", {
      sessionId: "ses-1",
      paneId: "%1",
      description: "test",
      attachActivated: false,
      createdAt: new Date(Date.now() - 15_000),
      lastSeenAt: new Date(),
      closePending: false,
      closeRetryCount: 0,
      activityVersion: 0,
    })

    const closedSessionIds: string[] = []
    const client = {
      session: {
        status: async () => ({ data: { "ses-1": { type: "idle" } } }),
        messages: async () => ({ data: [] }),
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
    expect(closedSessionIds).toEqual(["ses-1"])
  })
})
