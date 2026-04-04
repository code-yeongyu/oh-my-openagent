/// <reference types="bun-types" />

import { beforeEach, describe, expect, it, mock, afterAll } from "bun:test"

const logMock = mock(() => {})

mock.module("../shared/logger", () => ({
  log: logMock,
}))

afterAll(() => { mock.restore() })

const { createPreemptiveCompactionHook } = await import("./preemptive-compaction")

type AssistantHistoryMessage = {
  info: {
    id: string
    role: "assistant"
  }
  parts: Array<{ type: string; text?: string }>
}

function createMockCtx(sessionHistory: AssistantHistoryMessage[]) {
  return {
    client: {
      session: {
        messages: mock(() => Promise.resolve({ data: sessionHistory })),
        summarize: mock(() => Promise.resolve({})),
      },
      tui: {
        showToast: mock(() => Promise.resolve({})),
      },
    },
    directory: "/tmp/test",
  }
}

function appendAssistantHistory(
  sessionHistory: AssistantHistoryMessage[],
  input: {
    id: string
    parts: AssistantHistoryMessage["parts"]
  },
): void {
  sessionHistory.push({
    info: {
      id: input.id,
      role: "assistant",
    },
    parts: input.parts,
  })
}

function buildAssistantUpdate(input: {
  sessionID: string
  id: string
  parts: unknown[]
}): {
  event: {
    type: string
    properties: {
      info: {
        id: string
        role: string
        sessionID: string
        providerID: string
        modelID: string
        finish: boolean
        tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
        parts: unknown[]
      }
    }
  }
} {
  return {
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: input.id,
          role: "assistant",
          sessionID: input.sessionID,
          providerID: "anthropic",
          modelID: "claude-sonnet-4-6",
          finish: true,
          tokens: { input: 1000, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
          parts: input.parts,
        },
      },
    },
  }
}

describe("preemptive-compaction post-compaction degradation monitor", () => {
  beforeEach(() => {
    logMock.mockClear()
  })

  it("triggers recovery summarize after three consecutive no-text tail messages", async () => {
    // given
    const sessionHistory: AssistantHistoryMessage[] = []
    const ctx = createMockCtx(sessionHistory)
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never)
    const sessionID = "ses_tail_recovery"

    await hook.event({
      event: {
        type: "session.compacted",
        properties: { sessionID },
      },
    })

    const stepOnlyParts = [{ type: "step-start" }, { type: "step-finish" }]

    // when
    appendAssistantHistory(sessionHistory, { id: "msg_1", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_1", parts: stepOnlyParts }))

    appendAssistantHistory(sessionHistory, { id: "msg_2", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_2", parts: stepOnlyParts }))

    appendAssistantHistory(sessionHistory, { id: "msg_3", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_3", parts: stepOnlyParts }))

    // then
    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)
    expect(ctx.client.tui.showToast).toHaveBeenCalledTimes(1)
    expect(logMock).toHaveBeenCalledWith(
      "[preemptive-compaction] Detected post-compaction no-text tail pattern",
      {
        sessionID,
        streak: 3,
      },
    )
  })

  it("resets no-text streak when assistant emits text content", async () => {
    // given
    const sessionHistory: AssistantHistoryMessage[] = []
    const ctx = createMockCtx(sessionHistory)
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never)
    const sessionID = "ses_tail_reset"

    await hook.event({
      event: {
        type: "session.compacted",
        properties: { sessionID },
      },
    })

    // when
    appendAssistantHistory(sessionHistory, {
      id: "msg_1",
      parts: [{ type: "step-start" }, { type: "step-finish" }],
    })
    await hook.event(buildAssistantUpdate({
      sessionID,
      id: "msg_1",
      parts: [{ type: "step-start" }, { type: "step-finish" }],
    }))

    appendAssistantHistory(sessionHistory, {
      id: "msg_2",
      parts: [{ type: "text", text: "Recovered response" }],
    })
    await hook.event(buildAssistantUpdate({
      sessionID,
      id: "msg_2",
      parts: [{ type: "text", text: "Recovered response" }],
    }))

    appendAssistantHistory(sessionHistory, {
      id: "msg_3",
      parts: [{ type: "step-start" }, { type: "step-finish" }],
    })
    await hook.event(buildAssistantUpdate({
      sessionID,
      id: "msg_3",
      parts: [{ type: "step-start" }, { type: "step-finish" }],
    }))

    appendAssistantHistory(sessionHistory, {
      id: "msg_4",
      parts: [{ type: "step-start" }, { type: "step-finish" }],
    })
    await hook.event(buildAssistantUpdate({
      sessionID,
      id: "msg_4",
      parts: [{ type: "step-start" }, { type: "step-finish" }],
    }))

    // then
    expect(ctx.client.session.summarize).not.toHaveBeenCalled()
  })
})
