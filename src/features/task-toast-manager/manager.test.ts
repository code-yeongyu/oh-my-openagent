import { describe, test, expect, beforeEach, mock } from "bun:test"
import { TaskToastManager } from "./manager"
import type { ConcurrencyManager } from "../background-agent/concurrency"

describe("TaskToastManager", () => {
  let mockClient: {
    tui: {
      showToast: ReturnType<typeof mock>
    }
  }
  let toastManager: TaskToastManager
  let mockConcurrencyManager: ConcurrencyManager

  beforeEach(() => {
    mockClient = {
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
    }
    mockConcurrencyManager = {
      getConcurrencyLimit: mock(() => 5),
    } as unknown as ConcurrencyManager
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toastManager = new TaskToastManager(mockClient as any, mockConcurrencyManager)
  })

  describe("skills in toast message", () => {
    test("should display skills when provided", () => {
      // #given - a task with skills
      const task = {
        id: "task_1",
        description: "Test task",
        agent: "Sisyphus-Junior",
        isBackground: true,
        skills: ["playwright", "git-master"],
      }

      // #when - addTask is called
      toastManager.addTask(task)

      // #then - toast message should include skills
      expect(mockClient.tui.showToast).toHaveBeenCalled()
      const call = mockClient.tui.showToast.mock.calls[0][0]
      expect(call.body.message).toContain("playwright")
      expect(call.body.message).toContain("git-master")
    })

    test("should not display skills section when no skills provided", () => {
      // #given - a task without skills
      const task = {
        id: "task_2",
        description: "Test task without skills",
        agent: "explore",
        isBackground: true,
      }

      // #when - addTask is called
      toastManager.addTask(task)

      // #then - toast message should not include skills prefix
      expect(mockClient.tui.showToast).toHaveBeenCalled()
      const call = mockClient.tui.showToast.mock.calls[0][0]
      expect(call.body.message).not.toContain("Skills:")
    })
  })

  describe("concurrency info in toast message", () => {
    test("should display concurrency status in toast", () => {
      // #given - multiple running tasks
      toastManager.addTask({
        id: "task_1",
        description: "First task",
        agent: "explore",
        isBackground: true,
      })
      toastManager.addTask({
        id: "task_2",
        description: "Second task",
        agent: "librarian",
        isBackground: true,
      })

      // #when - third task is added
      toastManager.addTask({
        id: "task_3",
        description: "Third task",
        agent: "explore",
        isBackground: true,
      })

      // #then - toast should show concurrency info
      expect(mockClient.tui.showToast).toHaveBeenCalledTimes(3)
      const lastCall = mockClient.tui.showToast.mock.calls[2][0]
      // Should show "Running (3):" header
      expect(lastCall.body.message).toContain("Running (3):")
    })

    test("should display concurrency limit info when available", () => {
      // #given - a concurrency manager with known limit
      const mockConcurrencyWithCounts = {
        getConcurrencyLimit: mock(() => 5),
        getRunningCount: mock(() => 2),
        getQueuedCount: mock(() => 1),
      } as unknown as ConcurrencyManager

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const managerWithConcurrency = new TaskToastManager(mockClient as any, mockConcurrencyWithCounts)

      // #when - a task is added
      managerWithConcurrency.addTask({
        id: "task_1",
        description: "Test task",
        agent: "explore",
        isBackground: true,
      })

      // #then - toast should show concurrency status like "2/5 slots"
      expect(mockClient.tui.showToast).toHaveBeenCalled()
      const call = mockClient.tui.showToast.mock.calls[0][0]
      expect(call.body.message).toMatch(/\d+\/\d+/)
    })
  })

  describe("combined skills and concurrency display", () => {
    test("should display both skills and concurrency info together", () => {
      // #given - a task with skills and concurrency manager
      const task = {
        id: "task_1",
        description: "Full info task",
        agent: "Sisyphus-Junior",
        isBackground: true,
        skills: ["frontend-ui-ux"],
      }

      // #when - addTask is called
      toastManager.addTask(task)

      // #then - toast should include both skills and task count
      expect(mockClient.tui.showToast).toHaveBeenCalled()
      const call = mockClient.tui.showToast.mock.calls[0][0]
      expect(call.body.message).toContain("frontend-ui-ux")
      expect(call.body.message).toContain("Running (1):")
    })
  })
})
