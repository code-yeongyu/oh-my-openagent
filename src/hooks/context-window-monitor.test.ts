import { describe, it, expect, mock, beforeEach } from "bun:test"
import { createContextWindowMonitorHook } from "./context-window-monitor"

function createMockCtx() {
  return {
    client: {
      session: {
        messages: mock(() => Promise.resolve({ data: [] })),
      },
    },
    directory: "/tmp/test",
  }
}

describe("context-window-monitor", () => {
  let ctx: ReturnType<typeof createMockCtx>

  beforeEach(() => {
    ctx = createMockCtx()
  })

  // #given event caches token info from message.updated
  // #when tool.execute.after is called
  // #then session.messages() should NOT be called
  it("should use cached token info instead of fetching session.messages()", async () => {
    const hook = createContextWindowMonitorHook(ctx as never)
    const sessionID = "ses_test1"

    // Simulate message.updated event with token info
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "anthropic",
            finish: true,
            tokens: {
              input: 50000,
              output: 1000,
              reasoning: 0,
              cache: { read: 10000, write: 0 },
            },
          },
        },
      },
    })

    const output = { title: "", output: "test output", metadata: null }
    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      output
    )

    // session.messages() should NOT have been called
    expect(ctx.client.session.messages).not.toHaveBeenCalled()
  })

  // #given no cached token info exists
  // #when tool.execute.after is called
  // #then should skip gracefully without fetching
  it("should skip gracefully when no cached token info exists", async () => {
    const hook = createContextWindowMonitorHook(ctx as never)
    const sessionID = "ses_no_cache"

    const output = { title: "", output: "test output", metadata: null }
    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      output
    )

    // No fetch, no crash
    expect(ctx.client.session.messages).not.toHaveBeenCalled()
    expect(output.output).toBe("test output")
  })

  // #given token usage exceeds 70% threshold
  // #when tool.execute.after is called
  // #then context reminder should be appended to output
  it("should append context reminder when usage exceeds threshold", async () => {
    const hook = createContextWindowMonitorHook(ctx as never)
    const sessionID = "ses_high_usage"

    // 150K input + 10K cache read = 160K, which is 80% of 200K limit
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "anthropic",
            finish: true,
            tokens: {
              input: 150000,
              output: 1000,
              reasoning: 0,
              cache: { read: 10000, write: 0 },
            },
          },
        },
      },
    })

    const output = { title: "", output: "original", metadata: null }
    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      output
    )

    expect(output.output).toContain("context remaining")
    expect(ctx.client.session.messages).not.toHaveBeenCalled()
  })

  // #given session is deleted
  // #when session.deleted event fires
  // #then cached data should be cleaned up
  it("should clean up cache on session.deleted", async () => {
    const hook = createContextWindowMonitorHook(ctx as never)
    const sessionID = "ses_deleted"

    // Cache some data
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "anthropic",
            finish: true,
            tokens: { input: 150000, output: 0, reasoning: 0, cache: { read: 10000, write: 0 } },
          },
        },
      },
    })

    // Delete session
    await hook.event({
      event: {
        type: "session.deleted",
        properties: { info: { id: sessionID } },
      },
    })

    // After deletion, no reminder should fire (cache gone, reminded set gone)
    const output = { title: "", output: "test", metadata: null }
    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      output
    )
    expect(output.output).toBe("test")
  })

  // #given non-anthropic provider
  // #when message.updated fires
  // #then should not trigger reminder
  it("should ignore non-anthropic providers", async () => {
    const hook = createContextWindowMonitorHook(ctx as never)
    const sessionID = "ses_openai"

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "openai",
            finish: true,
            tokens: { input: 200000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        },
      },
    })

    const output = { title: "", output: "test", metadata: null }
    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      output
    )
    expect(output.output).toBe("test")
  })
})
