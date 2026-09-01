import { afterAll, describe, expect, it, mock } from "bun:test"

mock.module("../../shared/system-directive", () => ({
  createSystemDirective: (type: string) => `[DIRECTIVE:${type}]`,
  SystemDirectiveTypes: {
    TODO_CONTINUATION: "TODO CONTINUATION",
    RALPH_LOOP: "RALPH LOOP",
    BOULDER_CONTINUATION: "BOULDER CONTINUATION",
    DELEGATION_REQUIRED: "DELEGATION REQUIRED",
    SINGLE_TASK_ONLY: "SINGLE TASK ONLY",
    COMPACTION_CONTEXT: "COMPACTION CONTEXT",
    CONTEXT_WINDOW_MONITOR: "CONTEXT WINDOW MONITOR",
    PROMETHEUS_READ_ONLY: "PROMETHEUS READ-ONLY",
  },
}))

afterAll(() => {
  mock.restore()
})

import type { BackgroundManager } from "../../features/background-agent"
import { TaskHistory } from "../../features/background-agent/task-history"
import { createCompactionContextInjector } from "./index"

function createMockBackgroundManager(): BackgroundManager {
  return { taskHistory: new TaskHistory() } as BackgroundManager
}

describe("createCompactionContextInjector prompt", () => {

  describe("Delegated Agent Sessions", () => {
    it("injects actual task history when backgroundManager and sessionID provided", async () => {
      //#given
      const mockManager = createMockBackgroundManager()
      mockManager.taskHistory.record("ses_parent", { id: "t1", sessionID: "ses_child", agent: "explore", description: "Find patterns", status: "completed", category: "quick" })
      const injector = createCompactionContextInjector({ backgroundManager: mockManager })

      //#when
      const prompt = injector.inject("ses_parent")

      //#then
      expect(prompt).toContain("`ses_child`")
      expect(prompt).toContain("`t1`")
    })

    it("does not inject task history section when no entries exist", async () => {
      //#given
      const mockManager = createMockBackgroundManager()
      mockManager.taskHistory.record("ses_other", { id: "other", sessionID: "ses_child_other", agent: "explore", description: "Unrelated", status: "completed", category: "quick" })
      const injector = createCompactionContextInjector({ backgroundManager: mockManager })

      //#when
      const prompt = injector.inject("ses_empty")

      //#then
      expect(prompt).not.toContain("`ses_child_other`")
      expect(prompt).not.toContain("`other`")
    })

    it("keeps injected delegated history bounded for long task lists", async () => {
      //#given
      const mockManager = createMockBackgroundManager()
      for (let i = 0; i < 100; i++) {
        mockManager.taskHistory.record("ses_parent", {
          id: `t${i}`,
          sessionID: `ses_child_${i}`,
          agent: "explore",
          description: "Inspect verbose delegated task context. ".repeat(200),
          status: "completed",
          category: "quick",
        })
      }
      const injector = createCompactionContextInjector({ backgroundManager: mockManager })

      //#when
      const prompt = injector.inject("ses_parent")

      //#then - only the most recent entries survive the compaction cap
      expect(prompt).toContain("`t99`")
      expect(prompt).not.toContain("`t0`")
    })
  })
})
