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

import { createCompactionContextInjector } from "./index"
import { setCompactionAgentConfigCheckpoint } from "../../shared/compaction-agent-config-checkpoint"

type PromptAsyncInput = {
  path: { id: string }
  body: {
    noReply?: boolean
    agent?: string
    model?: { providerID: string; modelID: string }
    tools?: Record<string, boolean | "allow" | "deny" | "ask">
    parts: Array<{
      type: "text"
      text: string
      synthetic?: true
      metadata?: { compaction_continue?: true }
    }>
  }
  query?: { directory: string }
}

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
  describe("agent checkpoint recovery", () => {
    it("re-injects checkpointed agent config after compaction when latest agent is lost", async () => {
      //#given
      const promptAsyncMock = mock(async (_input: PromptAsyncInput) => ({}))
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
                tools: { bash: true },
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
      const recoveryCall = promptAsyncMock.mock.calls[0]?.[0]
      expect(recoveryCall?.path).toEqual({ id: "ses_checkpoint" })
      expect(recoveryCall?.body.noReply).toBe(true)
      expect(recoveryCall?.body.agent).toBe("atlas")
      expect(recoveryCall?.body.model).toEqual({ providerID: "openai", modelID: "gpt-5" })
      expect(recoveryCall?.body.tools).toEqual({ bash: true })
      expect(recoveryCall?.body.parts[0]?.type).toBe("text")
      expect(recoveryCall?.body.parts[0]?.text).toContain("restore checkpointed session agent configuration")
      expect(recoveryCall?.body.parts[0]?.synthetic).toBe(true)
      expect(recoveryCall?.body.parts[0]?.metadata).toEqual({ compaction_continue: true })
      expect(recoveryCall?.query).toEqual({ directory: "/tmp/test" })
    })

    it("re-injects checkpointed agent config during autocontinue before synthetic continue", async () => {
      //#given
      const promptAsyncMock = mock(async (_input: PromptAsyncInput) => ({}))
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
                tools: { bash: true },
              },
            },
          ],
        ],
        promptAsyncMock,
      )
      const injector = createCompactionContextInjector({ ctx })

      //#when
      await injector.capture("ses_autocontinue_checkpoint")
      const restored = await injector.restore("ses_autocontinue_checkpoint")

      //#then
      expect(restored).toBe(true)
      const recoveryCall = promptAsyncMock.mock.calls[0]?.[0]
      expect(recoveryCall?.path).toEqual({ id: "ses_autocontinue_checkpoint" })
      expect(recoveryCall?.body.noReply).toBe(true)
      expect(recoveryCall?.body.agent).toBe("atlas")
      expect(recoveryCall?.body.model).toEqual({ providerID: "openai", modelID: "gpt-5" })
      expect(recoveryCall?.body.tools).toEqual({ bash: true })
      expect(recoveryCall?.body.parts[0]?.type).toBe("text")
      expect(recoveryCall?.body.parts[0]?.text).toContain("restore checkpointed session agent configuration")
      expect(recoveryCall?.body.parts[0]?.synthetic).toBe(true)
      expect(recoveryCall?.body.parts[0]?.metadata).toEqual({ compaction_continue: true })
      expect(recoveryCall?.query).toEqual({ directory: "/tmp/test" })
    })

    it("clears stale checkpoint when the next compaction capture has no prompt config", async () => {
      //#given
      const promptAsyncMock = mock(async () => ({}))
      const sessionID = "ses_empty_checkpoint_capture"
      setCompactionAgentConfigCheckpoint(sessionID, {
        agent: "atlas",
        model: { providerID: "openai", modelID: "gpt-5" },
        tools: { bash: true },
      })
      const ctx = createMockContext([[], [], []], promptAsyncMock)
      const injector = createCompactionContextInjector({ ctx })

      //#when
      await injector.capture(sessionID)
      const restored = await injector.restore(sessionID)

      //#then
      expect(restored).toBe(false)
      expect(promptAsyncMock).not.toHaveBeenCalled()
    })

  })
})
