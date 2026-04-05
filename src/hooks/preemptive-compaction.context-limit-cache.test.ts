import { describe, expect, it, mock, afterAll } from "bun:test"

import { applyProviderConfig } from "../plugin-handlers/provider-config-handler"
import { createModelCacheState } from "../plugin-state"

const logMock = mock(() => {})

mock.module("../shared/logger", () => ({
  log: logMock,
}))

afterAll(() => { mock.restore() })

const { createPreemptiveCompactionHook } = await import("./preemptive-compaction")

function createMockCtx() {
  return {
    client: {
      session: {
        messages: mock(() => Promise.resolve({ data: [] })),
        summarize: mock(() => Promise.resolve({})),
      },
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
    },
    directory: "/tmp/test",
  }
}

describe("preemptive-compaction context-limit cache invalidation", () => {
  it("skips compaction after provider config removes a cached model limit", async () => {
    // given
    const ctx = createMockCtx()
    const modelCacheState = createModelCacheState()
    const sessionID = "ses_removed_limit"

    applyProviderConfig({
      config: {
        provider: {
          opencode: {
            models: {
              "kimi-k2.5-free": {
                limit: { context: 200000 },
              },
            },
          },
        },
      },
      modelCacheState,
    })

    const hook = createPreemptiveCompactionHook(ctx as never, {} as never, modelCacheState)

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "opencode",
            modelID: "kimi-k2.5-free",
            finish: true,
            tokens: {
              input: 170000,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        },
      },
    })

    applyProviderConfig({
      config: {
        provider: {
          opencode: {
            models: {},
          },
        },
      },
      modelCacheState,
    })

    // when
    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    // then
    expect(ctx.client.session.summarize).not.toHaveBeenCalled()
  })
})
