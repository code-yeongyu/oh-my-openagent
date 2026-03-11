/// <reference types="bun-types" />

import { describe, it, expect, mock, beforeEach } from "bun:test"

const logMock = mock(() => {})

mock.module("../../shared/logger", () => ({
  log: logMock,
}))

const classifyMessagesMock = mock((_messages: unknown, _config: unknown) => [])
const compressMessagesMock = mock((_messages: unknown, _classifications: unknown, _config: unknown, _tokensToFree: unknown) => ({
  toolOutputsCompressed: 0,
  thinkingBlocksRemoved: 0,
  textPartsCompressed: 1,
  systemPartsRemoved: 0,
  messagesRemoved: 0,
}))

mock.module("../../features/context-gc", () => ({
  classifyMessages: classifyMessagesMock,
  compressMessages: compressMessagesMock,
}))

const { createContextGcHook } = await import("./hook")

function makeMessage(sessionID: string, role = "user") {
  return {
    info: { id: `msg_${Math.random()}`, role, sessionID },
    parts: [{ type: "text", text: "hello world ".repeat(100) }],
  }
}

function makeMessageUpdatedEvent(sessionID: string, input: number, cacheRead: number) {
  return {
    event: {
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          sessionID,
          finish: true,
          tokens: { input, output: 0, reasoning: 0, cache: { read: cacheRead, write: 0 } },
        },
      },
    },
  }
}

describe("context-gc hook", () => {
  beforeEach(() => {
    logMock.mockClear()
    classifyMessagesMock.mockClear()
    compressMessagesMock.mockClear()
    delete process.env.ANTHROPIC_1M_CONTEXT
    delete process.env.VERTEX_ANTHROPIC_1M_CONTEXT
  })

  describe("#given no cached token info", () => {
    describe("#when messages.transform is called", () => {
      it("#then GC should not run", async () => {
        const hook = createContextGcHook({} as never)
        const messages = [makeMessage("ses_fresh")]
        await hook["experimental.chat.messages.transform"]!({} as never, { messages } as never)
        expect(classifyMessagesMock).not.toHaveBeenCalled()
      })
    })
  })

  describe("#given token usage below trigger threshold (60%)", () => {
    describe("#when messages.transform is called", () => {
      it("#then GC should not run", async () => {
        const sessionID = "ses_low"
        const hook = createContextGcHook({} as never)

        // 100k input + 0 cache = 50% of 200k — below 60% default trigger
        await hook.event!({ event: { type: "message.updated", properties: { info: { role: "assistant", sessionID, finish: true, tokens: { input: 100000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } } } } } as never)

        const messages = [makeMessage(sessionID)]
        await hook["experimental.chat.messages.transform"]!({} as never, { messages } as never)
        expect(classifyMessagesMock).not.toHaveBeenCalled()
      })
    })
  })

  describe("#given token usage above default 60% trigger threshold", () => {
    describe("#when messages.transform is called", () => {
      it("#then GC should run and log stats", async () => {
        const sessionID = "ses_high"
        const hook = createContextGcHook({} as never)

        // 130k input + 10k cache = 140k = 70% of 200k — above 60% trigger
        await hook.event!(makeMessageUpdatedEvent(sessionID, 130000, 10000) as never)

        const messages = [makeMessage(sessionID)]
        await hook["experimental.chat.messages.transform"]!({} as never, { messages } as never)

        expect(classifyMessagesMock).toHaveBeenCalledTimes(1)
        expect(compressMessagesMock).toHaveBeenCalledTimes(1)
        expect(logMock).toHaveBeenCalledWith(
          "[context-gc] GC cycle complete",
          expect.objectContaining({ sessionID })
        )
      })
    })
  })

  describe("#given GC ran recently (within cooldown)", () => {
    describe("#when messages.transform is called again immediately", () => {
      it("#then GC should be skipped", async () => {
        const sessionID = "ses_cooldown"
        const hook = createContextGcHook({ experimental: { context_gc_config: { gc_cooldown_ms: 60000 } } } as never)

        // 140k = 70% — above threshold
        await hook.event!(makeMessageUpdatedEvent(sessionID, 130000, 10000) as never)

        const messages = [makeMessage(sessionID)]
        await hook["experimental.chat.messages.transform"]!({} as never, { messages } as never)
        expect(classifyMessagesMock).toHaveBeenCalledTimes(1)

        // Call again immediately — should be throttled by cooldown
        await hook["experimental.chat.messages.transform"]!({} as never, { messages } as never)
        expect(classifyMessagesMock).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe("#given custom trigger percentage (80%)", () => {
    describe("#when usage is 70% (below custom threshold)", () => {
      it("#then GC should not run", async () => {
        const sessionID = "ses_custom_pct"
        const hook = createContextGcHook({ experimental: { context_gc_config: { gc_trigger_pct: 80 } } } as never)

        // 140k = 70% — below 80% custom trigger
        await hook.event!(makeMessageUpdatedEvent(sessionID, 130000, 10000) as never)

        const messages = [makeMessage(sessionID)]
        await hook["experimental.chat.messages.transform"]!({} as never, { messages } as never)
        expect(classifyMessagesMock).not.toHaveBeenCalled()
      })
    })
  })

  describe("#given session is deleted", () => {
    describe("#when messages.transform is called for that session after deletion", () => {
      it("#then GC should not run (cache cleared)", async () => {
        const sessionID = "ses_deleted"
        const hook = createContextGcHook({} as never)

        // Cache token info
        await hook.event!(makeMessageUpdatedEvent(sessionID, 150000, 10000) as never)

        // Delete session
        await hook.event!({ event: { type: "session.deleted", properties: { info: { id: sessionID } } } } as never)

        const messages = [makeMessage(sessionID)]
        await hook["experimental.chat.messages.transform"]!({} as never, { messages } as never)
        expect(classifyMessagesMock).not.toHaveBeenCalled()
      })
    })
  })

  describe("#given ANTHROPIC_1M_CONTEXT env is set", () => {
    describe("#when usage is 65% of 200k (below 60% of 1M)", () => {
      it("#then GC should not run against the 1M limit", async () => {
        process.env.ANTHROPIC_1M_CONTEXT = "true"
        const sessionID = "ses_1m"
        const hook = createContextGcHook({} as never)

        // 130k = 65% of 200k, but only 13% of 1M — well below 60% trigger
        await hook.event!(makeMessageUpdatedEvent(sessionID, 120000, 10000) as never)

        const messages = [makeMessage(sessionID)]
        await hook["experimental.chat.messages.transform"]!({} as never, { messages } as never)
        expect(classifyMessagesMock).not.toHaveBeenCalled()
      })
    })
  })

  describe("#given no sessionID in messages", () => {
    describe("#when messages.transform is called", () => {
      it("#then GC should skip gracefully", async () => {
        const hook = createContextGcHook({} as never)
        const messages = [{ info: { id: "msg_1", role: "user" }, parts: [] }]
        await hook["experimental.chat.messages.transform"]!({} as never, { messages } as never)
        expect(classifyMessagesMock).not.toHaveBeenCalled()
      })
    })
  })

  describe("#given empty messages array", () => {
    describe("#when messages.transform is called", () => {
      it("#then GC should skip without error", async () => {
        const hook = createContextGcHook({} as never)
        await hook["experimental.chat.messages.transform"]!({} as never, { messages: [] } as never)
        expect(classifyMessagesMock).not.toHaveBeenCalled()
      })
    })
  })

  describe("#given message.updated with non-assistant role", () => {
    describe("#when messages.transform runs after token info above threshold", () => {
      it("#then GC should not run (user messages do not update cache)", async () => {
        const sessionID = "ses_user_role"
        const hook = createContextGcHook({} as never)

        await hook.event!({ event: { type: "message.updated", properties: { info: { role: "user", sessionID, finish: true, tokens: { input: 150000, output: 0, reasoning: 0, cache: { read: 10000, write: 0 } } } } } } as never)

        const messages = [makeMessage(sessionID)]
        await hook["experimental.chat.messages.transform"]!({} as never, { messages } as never)
        expect(classifyMessagesMock).not.toHaveBeenCalled()
      })
    })
  })
})
