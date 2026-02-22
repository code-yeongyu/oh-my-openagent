import { describe, it, expect, mock } from "bun:test"

import { handleSessionIdleBackgroundEvent } from "./session-idle-event-handler"
import type { BackgroundTask } from "./types"
import { MIN_IDLE_TIME_MS } from "./constants"

function createRunningTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    sessionID: "ses-idle-1",
    parentSessionID: "parent-ses-1",
    parentMessageID: "msg-1",
    description: "test idle handler",
    prompt: "test",
    agent: "explore",
    status: "running",
    startedAt: new Date(Date.now() - (MIN_IDLE_TIME_MS + 100)),
    ...overrides,
  }
}

describe("handleSessionIdleBackgroundEvent", () => {
  describe("#given no sessionID in properties", () => {
    it("#then should do nothing", () => {
      //#given
      const tryCompleteTask = mock(() => Promise.resolve(true))

      //#when
      handleSessionIdleBackgroundEvent({
        properties: {},
        findBySession: () => undefined,
        idleDeferralTimers: new Map(),
        validateSessionHasOutput: () => Promise.resolve(true),
        checkSessionTodos: () => Promise.resolve(false),
        tryCompleteTask,
        emitIdleEvent: () => {},
      })

      //#then
      expect(tryCompleteTask).not.toHaveBeenCalled()
    })
  })

  describe("#given non-string sessionID in properties", () => {
    it("#then should do nothing", () => {
      //#given
      const tryCompleteTask = mock(() => Promise.resolve(true))

      //#when
      handleSessionIdleBackgroundEvent({
        properties: { sessionID: 123 },
        findBySession: () => undefined,
        idleDeferralTimers: new Map(),
        validateSessionHasOutput: () => Promise.resolve(true),
        checkSessionTodos: () => Promise.resolve(false),
        tryCompleteTask,
        emitIdleEvent: () => {},
      })

      //#then
      expect(tryCompleteTask).not.toHaveBeenCalled()
    })
  })

  describe("#given no task found for session", () => {
    it("#then should do nothing", () => {
      //#given
      const tryCompleteTask = mock(() => Promise.resolve(true))

      //#when
      handleSessionIdleBackgroundEvent({
        properties: { sessionID: "ses-unknown" },
        findBySession: () => undefined,
        idleDeferralTimers: new Map(),
        validateSessionHasOutput: () => Promise.resolve(true),
        checkSessionTodos: () => Promise.resolve(false),
        tryCompleteTask,
        emitIdleEvent: () => {},
      })

      //#then
      expect(tryCompleteTask).not.toHaveBeenCalled()
    })
  })

  describe("#given task is not running", () => {
    it("#then should do nothing", () => {
      //#given
      const task = createRunningTask({ status: "completed" })
      const tryCompleteTask = mock(() => Promise.resolve(true))

      //#when
      handleSessionIdleBackgroundEvent({
        properties: { sessionID: task.sessionID! },
        findBySession: () => task,
        idleDeferralTimers: new Map(),
        validateSessionHasOutput: () => Promise.resolve(true),
        checkSessionTodos: () => Promise.resolve(false),
        tryCompleteTask,
        emitIdleEvent: () => {},
      })

      //#then
      expect(tryCompleteTask).not.toHaveBeenCalled()
    })
  })

  describe("#given task has no startedAt", () => {
    it("#then should do nothing", () => {
      //#given
      const task = createRunningTask({ startedAt: undefined })
      const tryCompleteTask = mock(() => Promise.resolve(true))

      //#when
      handleSessionIdleBackgroundEvent({
        properties: { sessionID: task.sessionID! },
        findBySession: () => task,
        idleDeferralTimers: new Map(),
        validateSessionHasOutput: () => Promise.resolve(true),
        checkSessionTodos: () => Promise.resolve(false),
        tryCompleteTask,
        emitIdleEvent: () => {},
      })

      //#then
      expect(tryCompleteTask).not.toHaveBeenCalled()
    })
  })

  describe("#given elapsed time < MIN_IDLE_TIME_MS", () => {
    it("#when idle fires early #then should defer with timer", () => {
      //#given
      const realDateNow = Date.now
      const baseNow = realDateNow()
      const task = createRunningTask({ startedAt: new Date(baseNow) })
      const idleDeferralTimers = new Map<string, ReturnType<typeof setTimeout>>()
      const emitIdleEvent = mock(() => {})

      try {
        Date.now = () => baseNow + (MIN_IDLE_TIME_MS - 100)

        //#when
        handleSessionIdleBackgroundEvent({
          properties: { sessionID: task.sessionID! },
          findBySession: () => task,
          idleDeferralTimers,
          validateSessionHasOutput: () => Promise.resolve(true),
          checkSessionTodos: () => Promise.resolve(false),
          tryCompleteTask: () => Promise.resolve(true),
          emitIdleEvent,
        })

        //#then
        expect(idleDeferralTimers.has(task.id)).toBe(true)
        expect(emitIdleEvent).not.toHaveBeenCalled()
      } finally {
        clearTimeout(idleDeferralTimers.get(task.id)!)
        Date.now = realDateNow
      }
    })

    it("#when idle already deferred #then should not create duplicate timer", () => {
      //#given
      const realDateNow = Date.now
      const baseNow = realDateNow()
      const task = createRunningTask({ startedAt: new Date(baseNow) })
      const existingTimer = setTimeout(() => {}, 99999)
      const idleDeferralTimers = new Map<string, ReturnType<typeof setTimeout>>([
        [task.id, existingTimer],
      ])
      const emitIdleEvent = mock(() => {})

      try {
        Date.now = () => baseNow + (MIN_IDLE_TIME_MS - 100)

        //#when
        handleSessionIdleBackgroundEvent({
          properties: { sessionID: task.sessionID! },
          findBySession: () => task,
          idleDeferralTimers,
          validateSessionHasOutput: () => Promise.resolve(true),
          checkSessionTodos: () => Promise.resolve(false),
          tryCompleteTask: () => Promise.resolve(true),
          emitIdleEvent,
        })

        //#then
        expect(idleDeferralTimers.get(task.id)).toBe(existingTimer)
      } finally {
        clearTimeout(existingTimer)
        Date.now = realDateNow
      }
    })

    it("#when deferred timer fires #then should emit idle event", async () => {
      //#given
      const realDateNow = Date.now
      const baseNow = realDateNow()
      const task = createRunningTask({ startedAt: new Date(baseNow) })
      const idleDeferralTimers = new Map<string, ReturnType<typeof setTimeout>>()
      const emitIdleEvent = mock(() => {})
      const remainingMs = 50

      try {
        Date.now = () => baseNow + (MIN_IDLE_TIME_MS - remainingMs)

        //#when
        handleSessionIdleBackgroundEvent({
          properties: { sessionID: task.sessionID! },
          findBySession: () => task,
          idleDeferralTimers,
          validateSessionHasOutput: () => Promise.resolve(true),
          checkSessionTodos: () => Promise.resolve(false),
          tryCompleteTask: () => Promise.resolve(true),
          emitIdleEvent,
        })

        //#then - wait for deferred timer
        await new Promise((resolve) => setTimeout(resolve, remainingMs + 50))
        expect(emitIdleEvent).toHaveBeenCalledWith(task.sessionID)
        expect(idleDeferralTimers.has(task.id)).toBe(false)
      } finally {
        Date.now = realDateNow
      }
    })
  })

  describe("#given elapsed time >= MIN_IDLE_TIME_MS", () => {
    it("#when session has valid output and no incomplete todos #then should complete task", async () => {
      //#given
      const task = createRunningTask()
      const tryCompleteTask = mock(() => Promise.resolve(true))

      //#when
      handleSessionIdleBackgroundEvent({
        properties: { sessionID: task.sessionID! },
        findBySession: () => task,
        idleDeferralTimers: new Map(),
        validateSessionHasOutput: () => Promise.resolve(true),
        checkSessionTodos: () => Promise.resolve(false),
        tryCompleteTask,
        emitIdleEvent: () => {},
      })

      //#then
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(tryCompleteTask).toHaveBeenCalledWith(task, "session.idle event")
    })

    it("#when session has no valid output #then should not complete task", async () => {
      //#given
      const task = createRunningTask()
      const tryCompleteTask = mock(() => Promise.resolve(true))

      //#when
      handleSessionIdleBackgroundEvent({
        properties: { sessionID: task.sessionID! },
        findBySession: () => task,
        idleDeferralTimers: new Map(),
        validateSessionHasOutput: () => Promise.resolve(false),
        checkSessionTodos: () => Promise.resolve(false),
        tryCompleteTask,
        emitIdleEvent: () => {},
      })

      //#then
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(tryCompleteTask).not.toHaveBeenCalled()
    })

    it("#when task has incomplete todos #then should not complete task", async () => {
      //#given
      const task = createRunningTask()
      const tryCompleteTask = mock(() => Promise.resolve(true))

      //#when
      handleSessionIdleBackgroundEvent({
        properties: { sessionID: task.sessionID! },
        findBySession: () => task,
        idleDeferralTimers: new Map(),
        validateSessionHasOutput: () => Promise.resolve(true),
        checkSessionTodos: () => Promise.resolve(true),
        tryCompleteTask,
        emitIdleEvent: () => {},
      })

      //#then
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(tryCompleteTask).not.toHaveBeenCalled()
    })

    it("#when task status changes during validation #then should not complete task", async () => {
      //#given
      const task = createRunningTask()
      const tryCompleteTask = mock(() => Promise.resolve(true))

      //#when
      handleSessionIdleBackgroundEvent({
        properties: { sessionID: task.sessionID! },
        findBySession: () => task,
        idleDeferralTimers: new Map(),
        validateSessionHasOutput: async () => {
          task.status = "completed"
          return true
        },
        checkSessionTodos: () => Promise.resolve(false),
        tryCompleteTask,
        emitIdleEvent: () => {},
      })

      //#then
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(tryCompleteTask).not.toHaveBeenCalled()
    })

    it("#when task status changes during todo check #then should not complete task", async () => {
      //#given
      const task = createRunningTask()
      const tryCompleteTask = mock(() => Promise.resolve(true))

      //#when
      handleSessionIdleBackgroundEvent({
        properties: { sessionID: task.sessionID! },
        findBySession: () => task,
        idleDeferralTimers: new Map(),
        validateSessionHasOutput: () => Promise.resolve(true),
        checkSessionTodos: async () => {
          task.status = "cancelled"
          return false
        },
        tryCompleteTask,
        emitIdleEvent: () => {},
      })

      //#then
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(tryCompleteTask).not.toHaveBeenCalled()
    })
  })
})
