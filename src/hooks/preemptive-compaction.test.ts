import { describe, it, expect, mock, beforeEach } from "bun:test"

const logMock = mock(() => {})

mock.module("../shared/logger", () => ({
  log: logMock,
}))

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

describe("preemptive-compaction", () => {
  let ctx: ReturnType<typeof createMockCtx>

  beforeEach(() => {
    ctx = createMockCtx()
    logMock.mockClear()
  })

  // #given event caches token info from message.updated
  // #when tool.execute.after is called
  // #then session.messages() should NOT be called
  it("should use cached token info instead of fetching session.messages()", async () => {
    const hook = createPreemptiveCompactionHook(ctx as never)
    const sessionID = "ses_test1"

    // Simulate message.updated with token info below threshold
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "anthropic",
            modelID: "claude-sonnet-4-5",
            finish: true,
            tokens: {
              input: 50000,
              output: 1000,
              reasoning: 0,
              cache: { read: 5000, write: 0 },
            },
          },
        },
      },
    })

    const output = { title: "", output: "test", metadata: null }
    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      output
    )

    expect(ctx.client.session.messages).not.toHaveBeenCalled()
  })

  // #given no cached token info
  // #when tool.execute.after is called
  // #then should skip without fetching
  it("should skip gracefully when no cached token info exists", async () => {
    const hook = createPreemptiveCompactionHook(ctx as never)

    const output = { title: "", output: "test", metadata: null }
    await hook["tool.execute.after"](
      { tool: "bash", sessionID: "ses_none", callID: "call_1" },
      output
    )

    expect(ctx.client.session.messages).not.toHaveBeenCalled()
  })

  // #given usage above 78% threshold
  // #when tool.execute.after runs
  // #then should trigger summarize
  it("should trigger compaction when usage exceeds threshold", async () => {
    const hook = createPreemptiveCompactionHook(ctx as never)
    const sessionID = "ses_high"

    // 170K input + 10K cache = 180K → 90% of 200K
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "anthropic",
            modelID: "claude-sonnet-4-5",
            finish: true,
            tokens: {
              input: 170000,
              output: 1000,
              reasoning: 0,
              cache: { read: 10000, write: 0 },
            },
          },
        },
      },
    })

    const output = { title: "", output: "test", metadata: null }
    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      output
    )

    expect(ctx.client.session.messages).not.toHaveBeenCalled()
    expect(ctx.client.session.summarize).toHaveBeenCalled()
  })

  it("should trigger compaction for google-vertex-anthropic provider", async () => {
    //#given google-vertex-anthropic usage above threshold
    const hook = createPreemptiveCompactionHook(ctx as never)
    const sessionID = "ses_vertex_anthropic_high"

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "google-vertex-anthropic",
            modelID: "claude-sonnet-4-5",
            finish: true,
            tokens: {
              input: 170000,
              output: 1000,
              reasoning: 0,
              cache: { read: 10000, write: 0 },
            },
          },
        },
      },
    })

    //#when tool.execute.after runs
    const output = { title: "", output: "test", metadata: null }
    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      output
    )

    //#then summarize should be triggered
    expect(ctx.client.session.summarize).toHaveBeenCalled()
  })

  // #given session deleted
  // #then cache should be cleaned up
  it("should clean up cache on session.deleted", async () => {
    const hook = createPreemptiveCompactionHook(ctx as never)
    const sessionID = "ses_del"

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "anthropic",
            modelID: "claude-sonnet-4-5",
            finish: true,
            tokens: { input: 180000, output: 0, reasoning: 0, cache: { read: 10000, write: 0 } },
          },
        },
      },
    })

    await hook.event({
      event: {
        type: "session.deleted",
        properties: { info: { id: sessionID } },
      },
    })

    const output = { title: "", output: "test", metadata: null }
    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      output
    )

    expect(ctx.client.session.summarize).not.toHaveBeenCalled()
  })

  it("should log summarize errors instead of swallowing them", async () => {
    //#given
    const hook = createPreemptiveCompactionHook(ctx as never)
    const sessionID = "ses_log_error"
    const summarizeError = new Error("summarize failed")
    ctx.client.session.summarize.mockRejectedValueOnce(summarizeError)

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "anthropic",
            modelID: "claude-sonnet-4-5",
            finish: true,
            tokens: {
              input: 170000,
              output: 0,
              reasoning: 0,
              cache: { read: 10000, write: 0 },
            },
          },
        },
      },
    })

    //#when
    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_log" },
      { title: "", output: "test", metadata: null }
    )

    //#then
    expect(logMock).toHaveBeenCalledWith("[preemptive-compaction] Compaction failed", {
      sessionID,
      error: String(summarizeError),
    })
  })
})
