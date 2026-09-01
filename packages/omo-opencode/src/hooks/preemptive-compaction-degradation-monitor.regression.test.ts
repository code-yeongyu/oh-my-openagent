/// <reference types="bun-types" />

import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test"

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
}) {
  return {
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: input.id,
          role: "assistant",
          sessionID: input.sessionID,
          providerID: "opencode",
          modelID: "kimi-k2.5-free",
          finish: true,
          tokens: { input: 1000, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
          parts: input.parts,
        },
      },
    },
  }
}

describe("preemptive-compaction degradation monitor regressions", () => {
  beforeEach(() => {
    logMock.mockClear()
  })

  it("does not re-arm monitoring after recovery-triggered compaction", async () => {
    // given
    const sessionHistory: AssistantHistoryMessage[] = []
    const ctx = createMockCtx(sessionHistory)
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never)
    const sessionID = "ses_recovery_compaction_guard"
    const stepOnlyParts = [{ type: "step-start" }, { type: "step-finish" }]

    await hook.event({
      event: {
        type: "session.compacted",
        properties: { sessionID },
      },
    })

    // when
    appendAssistantHistory(sessionHistory, { id: "msg_1", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_1", parts: stepOnlyParts }))

    appendAssistantHistory(sessionHistory, { id: "msg_2", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_2", parts: stepOnlyParts }))

    appendAssistantHistory(sessionHistory, { id: "msg_3", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_3", parts: stepOnlyParts }))

    await hook.event({
      event: {
        type: "session.compacted",
        properties: { sessionID },
      },
    })

    appendAssistantHistory(sessionHistory, { id: "msg_4", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_4", parts: stepOnlyParts }))

    appendAssistantHistory(sessionHistory, { id: "msg_5", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_5", parts: stepOnlyParts }))

    appendAssistantHistory(sessionHistory, { id: "msg_6", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_6", parts: stepOnlyParts }))

    // then
    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)
  })
})
