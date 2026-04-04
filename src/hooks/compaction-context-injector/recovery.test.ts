/// <reference path="../../../bun-test.d.ts" />

import { describe, expect, it } from "bun:test"
import { setCompactionAgentConfigCheckpoint } from "../../shared/compaction-agent-config-checkpoint"
import { createCompactionContextInjector } from "./index"

type SessionMessageResponse = Array<{
  info?: Record<string, unknown>
}>

type PromptAsyncInput = {
  path: { id: string }
  body: {
    noReply?: boolean
    agent?: string
    model?: { providerID: string; modelID: string }
    tools?: Record<string, boolean>
    parts: Array<{ type: "text"; text: string }>
  }
  query?: { directory: string }
}

function createPromptAsyncRecorder(): {
  calls: PromptAsyncInput[]
  promptAsync: (input: PromptAsyncInput) => Promise<Record<string, never>>
} {
  const calls: PromptAsyncInput[] = []

  return {
    calls,
    promptAsync: async (input: PromptAsyncInput) => {
      calls.push(input)
      return {}
    },
  }
}

function createMockContext(
  messageResponses: SessionMessageResponse[],
  promptAsync: (input: PromptAsyncInput) => Promise<Record<string, never>>,
) {
  let callIndex = 0

  return {
    client: {
      session: {
        messages: async () => {
          const response =
            messageResponses[Math.min(callIndex, messageResponses.length - 1)] ?? []
          callIndex += 1
          return { data: response }
        },
        promptAsync,
      },
    },
    directory: "/tmp/test",
  }
}

function createAssistantMessageUpdatedEvent(sessionID: string, messageID: string) {
  return {
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: messageID,
          role: "assistant",
          sessionID,
        },
      },
    },
  } as const
}

function createMeaningfulPartUpdatedEvent(
  sessionID: string,
  messageID: string,
  type: "reasoning" | "tool_use",
) {
  return {
    event: {
      type: "message.part.updated",
      properties: {
        part: {
          messageID,
          sessionID,
          type,
          ...(type === "reasoning" ? { text: "thinking" } : {}),
        },
      },
    },
  } as const
}

describe("createCompactionContextInjector recovery", () => {
  it("re-injects after compaction when agent and model match but tools are missing", async () => {
    //#given
    const promptAsyncRecorder = createPromptAsyncRecorder()
    const ctx = createMockContext(
      [
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
              tools: { bash: true },
            },
          },
        ],
      ],
      promptAsyncRecorder.promptAsync,
    )
    const injector = createCompactionContextInjector({ ctx })

    //#when
    await injector.capture("ses_missing_tools")
    await injector.event({
      event: { type: "session.compacted", properties: { sessionID: "ses_missing_tools" } },
    })

    //#then
    expect(promptAsyncRecorder.calls.length).toBe(1)
    expect(promptAsyncRecorder.calls[0]?.body.agent).toBe("atlas")
    expect(promptAsyncRecorder.calls[0]?.body.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
    })
    expect(promptAsyncRecorder.calls[0]?.body.tools).toEqual({ bash: true })
  })

  it("retries recovery when the recovered prompt config still mismatches expected model or tools", async () => {
    //#given
    const promptAsyncRecorder = createPromptAsyncRecorder()
    const mismatchResponse = [
      {
        info: {
          role: "user",
          agent: "atlas",
          model: { providerID: "openai", modelID: "gpt-4.1" },
        },
      },
    ]
    const ctx = createMockContext(
      [
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
        mismatchResponse,
        mismatchResponse,
        mismatchResponse,
        mismatchResponse,
        mismatchResponse,
        mismatchResponse,
      ],
      promptAsyncRecorder.promptAsync,
    )
    const injector = createCompactionContextInjector({ ctx })

    //#when
    await injector.capture("ses_retry_incomplete_recovery")
    await injector.event({
      event: {
        type: "session.compacted",
        properties: { sessionID: "ses_retry_incomplete_recovery" },
      },
    })
    await injector.event({
      event: {
        type: "session.compacted",
        properties: { sessionID: "ses_retry_incomplete_recovery" },
      },
    })

    //#then
    expect(promptAsyncRecorder.calls.length).toBe(2)
  })

  it("does not treat reasoning-only assistant messages as a no-text tail", async () => {
    //#given
    const promptAsyncRecorder = createPromptAsyncRecorder()
    const matchingPromptConfig = [
      {
        info: {
          role: "user",
          agent: "atlas",
          model: { providerID: "openai", modelID: "gpt-5" },
          tools: { bash: true },
        },
      },
    ]
    const ctx = createMockContext(
      [matchingPromptConfig, matchingPromptConfig, matchingPromptConfig],
      promptAsyncRecorder.promptAsync,
    )
    const injector = createCompactionContextInjector({ ctx })
    const sessionID = "ses_reasoning_tail"

    await injector.capture(sessionID)
    await injector.event({
      event: { type: "session.compacted", properties: { sessionID } },
    })

    //#when
    for (let index = 1; index <= 5; index++) {
      const messageID = `msg_reasoning_${index}`
      await injector.event(createAssistantMessageUpdatedEvent(sessionID, messageID))
      await injector.event(
        createMeaningfulPartUpdatedEvent(sessionID, messageID, "reasoning"),
      )
      await injector.event({
        event: { type: "session.idle", properties: { sessionID } },
      })
    }

    //#then
    expect(promptAsyncRecorder.calls.length).toBe(0)
  })

  it("does not treat tool_use-only assistant messages as a no-text tail", async () => {
    //#given
    const promptAsyncRecorder = createPromptAsyncRecorder()
    const matchingPromptConfig = [
      {
        info: {
          role: "user",
          agent: "atlas",
          model: { providerID: "openai", modelID: "gpt-5" },
          tools: { bash: true },
        },
      },
    ]
    const ctx = createMockContext(
      [matchingPromptConfig, matchingPromptConfig, matchingPromptConfig],
      promptAsyncRecorder.promptAsync,
    )
    const injector = createCompactionContextInjector({ ctx })
    const sessionID = "ses_tool_use_tail"

    await injector.capture(sessionID)
    await injector.event({
      event: { type: "session.compacted", properties: { sessionID } },
    })

    //#when
    for (let index = 1; index <= 5; index++) {
      const messageID = `msg_tool_use_${index}`
      await injector.event(createAssistantMessageUpdatedEvent(sessionID, messageID))
      await injector.event(
        createMeaningfulPartUpdatedEvent(sessionID, messageID, "tool_use"),
      )
      await injector.event({
        event: { type: "session.idle", properties: { sessionID } },
      })
    }

    //#then
    expect(promptAsyncRecorder.calls.length).toBe(0)
  })

  it("falls back to the current non-compaction model when a checkpoint model is poisoned", async () => {
    //#given
    const sessionID = "ses_poisoned_checkpoint_model"
    const promptAsyncRecorder = createPromptAsyncRecorder()
    setCompactionAgentConfigCheckpoint(sessionID, {
      agent: "atlas",
      model: { providerID: "anthropic", modelID: "claude-opus-4-1" },
      tools: { bash: true },
    })
    const ctx = createMockContext(
      [
        [
          {
            info: {
              role: "user",
              agent: "atlas",
              model: { providerID: "openai", modelID: "gpt-5" },
              tools: { bash: true },
            },
          },
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
      promptAsyncRecorder.promptAsync,
    )
    const injector = createCompactionContextInjector({ ctx })

    //#when
    await injector.event({
      event: { type: "session.compacted", properties: { sessionID } },
    })

    //#then
    expect(promptAsyncRecorder.calls.length).toBe(1)
    expect(promptAsyncRecorder.calls[0]?.body.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
    })
  })
})
