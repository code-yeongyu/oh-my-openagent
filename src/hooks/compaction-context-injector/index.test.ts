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
import { TaskHistory } from "../../features/background-agent/task-history"

function createMockContext(
  messageResponses: Array<Array<{ info?: Record<string, unknown> }>>,
  promptAsyncMock = mock(async () => ({})),
) {
  let callIndex = 0

  return {
    client: {
      session: {
        messages: mock(async () => {
          const response = messageResponses[Math.min(callIndex, messageResponses.length - 1)] ?? []
          callIndex += 1
          return { data: response }
        }),
        promptAsync: promptAsyncMock,
      },
    },
    directory: "/tmp/test",
  }
}

describe("createCompactionContextInjector", () => {
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

  describe("Delegated Agent Sessions", () => {
    it("includes delegated sessions section in compaction prompt", async () => {
      //#given
      const injector = createCompactionContextInjector()

      //#when
      const prompt = injector.inject()

      //#then
      expect(prompt).toContain("Delegated Agent Sessions")
      expect(prompt).toContain("RESUME, DON'T RESTART")
      expect(prompt).toContain("session_id")
    })

    it("injects actual task history when backgroundManager and sessionID provided", async () => {
      //#given
      const mockManager = { taskHistory: new TaskHistory() } as any
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
      const mockManager = { taskHistory: new TaskHistory() } as any
      const injector = createCompactionContextInjector({ backgroundManager: mockManager })

      //#when
      const prompt = injector.inject("ses_empty")

      //#then
      expect(prompt).not.toContain("Active/Recent Delegated Sessions")
    })
  })

  describe("agent checkpoint recovery", () => {
    it("re-injects checkpointed agent config after compaction when latest agent is lost", async () => {
      //#given
      const promptAsyncMock = mock(async () => ({}))
      const ctx = createMockContext(
        [
          [
            {
              info: {
                role: "user",
                agent: "atlas",
                model: { providerID: "openai", modelID: "gpt-5" },
                tools: { bash: "allow" },
              },
            },
          ],
          [
            {
              info: {
                role: "user",
                agent: "compaction",
                model: { providerID: "anthropic", modelID: "claude-opus-4-1" },
              },
            },
          ],
          [
            {
              info: {
                role: "user",
                agent: "atlas",
                model: { providerID: "openai", modelID: "gpt-5" },
              },
            },
          ],
        ],
        promptAsyncMock,
      )
      const injector = createCompactionContextInjector({ ctx })

      //#when
      await injector.capture("ses_checkpoint")
      await injector.event({
        event: { type: "session.compacted", properties: { sessionID: "ses_checkpoint" } },
      })

      //#then
      expect(promptAsyncMock).toHaveBeenCalledWith({
        path: { id: "ses_checkpoint" },
        body: {
          noReply: true,
          agent: "atlas",
          model: { providerID: "openai", modelID: "gpt-5" },
          tools: { bash: true },
          parts: [
            {
              type: "text",
              text: expect.stringContaining("restore checkpointed session agent configuration"),
            },
          ],
        },
        query: { directory: "/tmp/test" },
      })
    })

    it("recovers after five consecutive assistant messages with no text", async () => {
      //#given
      const promptAsyncMock = mock(async () => ({}))
      const ctx = createMockContext(
        [
          [
            {
              info: {
                role: "user",
                agent: "atlas",
                model: { providerID: "openai", modelID: "gpt-5" },
              },
            },
          ],
          [
            {
              info: {
                role: "user",
                agent: "atlas",
                model: { providerID: "openai", modelID: "gpt-5" },
              },
            },
          ],
          [
            {
              info: {
                role: "user",
                agent: "atlas",
                model: { providerID: "openai", modelID: "gpt-5" },
              },
            },
          ],
        ],
        promptAsyncMock,
      )
      const injector = createCompactionContextInjector({ ctx })

      await injector.capture("ses_no_text_tail")
      await injector.event({
        event: { type: "session.compacted", properties: { sessionID: "ses_no_text_tail" } },
      })

      //#when
      for (let index = 1; index <= 5; index++) {
        await injector.event({
          event: {
            type: "message.updated",
            properties: {
              info: {
                id: `msg_${index}`,
                role: "assistant",
                sessionID: "ses_no_text_tail",
              },
            },
          },
        })
      }
      await injector.event({
        event: { type: "session.idle", properties: { sessionID: "ses_no_text_tail" } },
      })

      //#then
      expect(promptAsyncMock).toHaveBeenCalledTimes(1)
      expect(promptAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: "ses_no_text_tail" },
          body: expect.objectContaining({
            noReply: true,
            agent: "atlas",
          }),
        }),
      )
    })
  })
})
