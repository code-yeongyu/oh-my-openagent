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
        agent: "sisyphus-junior",
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
        agent: "sisyphus-junior",
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

  describe("model fallback info in toast message", () => {
    test("should NOT display warning when model is category-default (normal behavior)", () => {
      // #given - category-default is the intended behavior, not a fallback
      const task = {
        id: "task_1",
        description: "Task with category default model",
        agent: "sisyphus-junior",
        isBackground: false,
        modelInfo: { model: "google/gemini-3-pro", type: "category-default" as const },
      }

      // #when - addTask is called
      toastManager.addTask(task)

      // #then - toast should NOT show warning - category default is expected
      expect(mockClient.tui.showToast).toHaveBeenCalled()
      const call = mockClient.tui.showToast.mock.calls[0][0]
      expect(call.body.message).not.toContain("[FALLBACK]")
      expect(call.body.message).not.toContain("(category default)")
    })

    test("should display warning when model falls back to system-default", () => {
      // #given - system-default is a fallback (no category default, no user config)
      const task = {
        id: "task_1b",
        description: "Task with system default model",
        agent: "sisyphus-junior",
        isBackground: false,
        modelInfo: { model: "anthropic/claude-sonnet-4-5", type: "system-default" as const },
      }

      // #when - addTask is called
      toastManager.addTask(task)

      // #then - toast should show fallback warning
      expect(mockClient.tui.showToast).toHaveBeenCalled()
      const call = mockClient.tui.showToast.mock.calls[0][0]
      expect(call.body.message).toContain("[FALLBACK]")
      expect(call.body.message).toContain("anthropic/claude-sonnet-4-5")
      expect(call.body.message).toContain("(system default fallback)")
    })

    test("should display warning when model is inherited from parent", () => {
      // #given - inherited is a fallback (custom category without model definition)
      const task = {
        id: "task_2",
        description: "Task with inherited model",
        agent: "sisyphus-junior",
        isBackground: false,
        modelInfo: { model: "cliproxy/claude-opus-4-5", type: "inherited" as const },
      }

      // #when - addTask is called
      toastManager.addTask(task)

      // #then - toast should show fallback warning
      expect(mockClient.tui.showToast).toHaveBeenCalled()
      const call = mockClient.tui.showToast.mock.calls[0][0]
      expect(call.body.message).toContain("[FALLBACK]")
      expect(call.body.message).toContain("cliproxy/claude-opus-4-5")
      expect(call.body.message).toContain("(inherited from parent)")
    })

    test("should not display model info when user-defined", () => {
      // #given - a task with user-defined model
      const task = {
        id: "task_3",
        description: "Task with user model",
        agent: "sisyphus-junior",
        isBackground: false,
        modelInfo: { model: "my-provider/my-model", type: "user-defined" as const },
      }

      // #when - addTask is called
      toastManager.addTask(task)

      // #then - toast should NOT show model warning
      expect(mockClient.tui.showToast).toHaveBeenCalled()
      const call = mockClient.tui.showToast.mock.calls[0][0]
      expect(call.body.message).not.toContain("[FALLBACK] Model:")
      expect(call.body.message).not.toContain("(inherited)")
      expect(call.body.message).not.toContain("(category default)")
      expect(call.body.message).not.toContain("(system default)")
    })

    test("should not display model info when not provided", () => {
      // #given - a task without model info
      const task = {
        id: "task_4",
        description: "Task without model info",
        agent: "explore",
        isBackground: true,
      }

      // #when - addTask is called
      toastManager.addTask(task)

      // #then - toast should NOT show model warning
      expect(mockClient.tui.showToast).toHaveBeenCalled()
      const call = mockClient.tui.showToast.mock.calls[0][0]
      expect(call.body.message).not.toContain("[FALLBACK] Model:")
    })
  })
})
