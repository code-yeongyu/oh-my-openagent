declare const require: (name: string) => any
const { describe, it, expect, mock, spyOn, beforeEach, afterEach } = require("bun:test")

import { checkAndInterruptStaleTasks } from "./task-poller"
import type { BackgroundTask } from "./types"

describe("checkAndInterruptStaleTasks", () => {
  describe("#given a task with fallback retry in flight", () => {
    const mockClient = {
      session: {
        abort: mock(() => Promise.resolve()),
        get: mock(() => Promise.resolve({ data: { id: "ses-1" } })),
      },
    }
    const mockConcurrencyManager = {
      release: mock(() => {}),
    }
    const mockNotify = mock(() => Promise.resolve())
    const mockOnTaskInterrupted = mock(() => {})

    const originalDateNow = Date.now
    let fixedTime: number

    beforeEach(() => {
      fixedTime = Date.now()
      spyOn(globalThis.Date, "now").mockReturnValue(fixedTime)
      mockClient.session.abort.mockClear()
      mockClient.session.get.mockReset()
      mockClient.session.get.mockResolvedValue({ data: { id: "ses-1" } })
      mockConcurrencyManager.release.mockClear()
      mockNotify.mockClear()
      mockOnTaskInterrupted.mockClear()
    })

    afterEach(() => {
      Date.now = originalDateNow
    })

    function createStaleRunningTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
      return {
        id: "task-retry-1",
        sessionId: "ses-retry-1",
        parentSessionId: "parent-ses-1",
        parentMessageId: "msg-1",
        description: "test fallback retry race",
        prompt: "test",
        agent: "explore",
        status: "running",
        startedAt: new Date(fixedTime - 600_000),
        progress: {
          toolCalls: 5,
          lastUpdate: new Date(fixedTime - 300_000),
        },
        ...overrides,
      }
    }

    describe("#when the task id is in retryInFlightTaskIds", () => {
      it("#then should skip the stale interrupt", async () => {
        // given
        const task = createStaleRunningTask()
        const retryInFlightTaskIds = new Set(["task-retry-1"])

        // when
        await checkAndInterruptStaleTasks({
          tasks: [task],
          client: mockClient as never,
          config: { staleTimeoutMs: 180_000 },
          concurrencyManager: mockConcurrencyManager as never,
          notifyParentSession: mockNotify,
          onTaskInterrupted: mockOnTaskInterrupted,
          retryInFlightTaskIds,
        })

        // then
        expect(task.status).toBe("running")
        expect(mockClient.session.abort).not.toHaveBeenCalled()
        expect(mockConcurrencyManager.release).not.toHaveBeenCalled()
        expect(mockNotify).not.toHaveBeenCalled()
        expect(mockOnTaskInterrupted).not.toHaveBeenCalled()
      })
    })

    describe("#when the task id is NOT in retryInFlightTaskIds", () => {
      it("#then should interrupt the stale task normally", async () => {
        // given
        const task = createStaleRunningTask()
        const retryInFlightTaskIds = new Set(["some-other-task"])

        // when
        await checkAndInterruptStaleTasks({
          tasks: [task],
          client: mockClient as never,
          config: { staleTimeoutMs: 180_000 },
          concurrencyManager: mockConcurrencyManager as never,
          notifyParentSession: mockNotify,
          onTaskInterrupted: mockOnTaskInterrupted,
          retryInFlightTaskIds,
        })

        // then
        expect(task.status).toBe("cancelled")
        expect(mockClient.session.abort).toHaveBeenCalled()
        expect(mockOnTaskInterrupted).toHaveBeenCalledWith(task)
      })
    })

    describe("#when retryInFlightTaskIds is not provided", () => {
      it("#then should interrupt the stale task normally (backward compat)", async () => {
        // given
        const task = createStaleRunningTask()

        // when
        await checkAndInterruptStaleTasks({
          tasks: [task],
          client: mockClient as never,
          config: { staleTimeoutMs: 180_000 },
          concurrencyManager: mockConcurrencyManager as never,
          notifyParentSession: mockNotify,
          onTaskInterrupted: mockOnTaskInterrupted,
        })

        // then
        expect(task.status).toBe("cancelled")
        expect(mockClient.session.abort).toHaveBeenCalled()
      })
    })
  })
})
