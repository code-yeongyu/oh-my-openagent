import { describe, expect, it, mock } from "bun:test"

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

import { createCompactionContextInjector } from "./index"

describe("createCompactionContextInjector", () => {
  describe("Agent Verification State preservation", () => {
    it("includes Agent Verification State section in compaction prompt", async () => {
      //#given
      const injector = createCompactionContextInjector()

      //#when
      const prompt = injector()

      //#then
      expect(prompt).toContain("Agent Verification State")
      expect(prompt).toContain("Current Agent")
      expect(prompt).toContain("Verification Progress")
    })

    it("includes reviewer-agent continuity fields", async () => {
      //#given
      const injector = createCompactionContextInjector()

      //#when
      const prompt = injector()

      //#then
      expect(prompt).toContain("Previous Rejections")
      expect(prompt).toContain("Acceptance Status")
      expect(prompt).toContain("reviewer agents")
    })

    it("preserves file verification progress fields", async () => {
      //#given
      const injector = createCompactionContextInjector()

      //#when
      const prompt = injector()

      //#then
      expect(prompt).toContain("Pending Verifications")
      expect(prompt).toContain("Files already verified")
    })
  })

  it("restricts constraints to explicit verbatim statements", async () => {
    //#given
    const injector = createCompactionContextInjector()

    //#when
    const prompt = injector()

    //#then
    expect(prompt).toContain("Explicit Constraints (Verbatim Only)")
    expect(prompt).toContain("Do NOT invent")
    expect(prompt).toContain("Quote constraints verbatim")
  })
})
