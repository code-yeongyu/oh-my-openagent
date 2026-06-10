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
  describe("Agent Verification State preservation", () => {
    it("includes Agent Verification State section in compaction prompt", async () => {
      //#given
      const injector = createCompactionContextInjector()

      //#when
      const prompt = injector.inject()

      //#then
      expect(prompt).toContain("Agent Verification State")
      expect(prompt).toContain("Current Agent")
      expect(prompt).toContain("Verification Progress")
    })

    it("includes reviewer-agent continuity fields", async () => {
      //#given
      const injector = createCompactionContextInjector()

      //#when
      const prompt = injector.inject()

      //#then
      expect(prompt).toContain("Previous Rejections")
      expect(prompt).toContain("Acceptance Status")
      expect(prompt).toContain("reviewer agents")
    })

    it("preserves file verification progress fields", async () => {
      //#given
      const injector = createCompactionContextInjector()

      //#when
      const prompt = injector.inject()

      //#then
      expect(prompt).toContain("Pending Verifications")
      expect(prompt).toContain("Files already verified")
    })
  })

  it("restricts constraints to explicit verbatim statements", async () => {
    //#given
    const injector = createCompactionContextInjector()

    //#when
    const prompt = injector.inject()

    //#then
    expect(prompt).toContain("Explicit Constraints (Verbatim Only)")
    expect(prompt).toContain("Do NOT invent")
    expect(prompt).toContain("Quote constraints verbatim")
  })

  it("does not ask the compaction agent to replay complete history verbatim", async () => {
    //#given
    const injector = createCompactionContextInjector()

    //#when
    const prompt = injector.inject()

    //#then
    expect(prompt).not.toContain("List all original user requests exactly as they were stated")
    expect(prompt).toContain("latest unresolved user requests")
    expect(prompt).toContain("Do not paste full AGENTS.md")
  })

  describe("Delegated Agent Sessions", () => {
    it("includes delegated sessions section in compaction prompt", async () => {
      //#given
      const injector = createCompactionContextInjector()

      //#when
      const prompt = injector.inject()

      //#then
      expect(prompt).toContain("Delegated Agent Sessions")
      expect(prompt).toContain("RESUME, DON'T RESTART")
      expect(prompt).toContain("task_id")
    })

    it("injects actual task history when backgroundManager and sessionID provided", async () => {
      //#given
      const mockManager = createMockBackgroundManager()
      mockManager.taskHistory.record("ses_parent", { id: "t1", sessionID: "ses_child", agent: "explore", description: "Find patterns", status: "completed", category: "quick" })
      const injector = createCompactionContextInjector({ backgroundManager: mockManager })

      //#when
      const prompt = injector.inject("ses_parent")

      //#then
      expect(prompt).toContain("Active/Recent Delegated Sessions")
      expect(prompt).toContain("**explore**")
      expect(prompt).toContain("[quick]")
      expect(prompt).toContain("`ses_child`")
    })

    it("does not inject task history section when no entries exist", async () => {
      //#given
      const mockManager = createMockBackgroundManager()
      const injector = createCompactionContextInjector({ backgroundManager: mockManager })

      //#when
      const prompt = injector.inject("ses_empty")

      //#then
      expect(prompt).not.toContain("Active/Recent Delegated Sessions")
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

      //#then
      expect(prompt.length).toBeLessThanOrEqual(9_000)
      expect(prompt).toContain("older delegated sessions omitted")
      expect(prompt).toContain("`t99`")
      expect(prompt).not.toContain("`t0`")
    })
  })
})
