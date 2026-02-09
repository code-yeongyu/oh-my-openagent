import { describe, expect, mock, test } from "bun:test"
import { createPreemptiveCompactionHook } from "./preemptive-compaction.ts"

describe("preemptive-compaction", () => {
  const sessionID = "preemptive-compaction-session"

  function createMockCtx(overrides?: {
    messages?: ReturnType<typeof mock>
    summarize?: ReturnType<typeof mock>
  }) {
    const messages = overrides?.messages ?? mock(() => Promise.resolve({ data: [] }))
    const summarize = overrides?.summarize ?? mock(() => Promise.resolve())

    return {
      client: {
        session: {
          messages,
          summarize,
        },
        tui: {
          showToast: mock(() => Promise.resolve()),
        },
      },
      directory: "/tmp/test",
    } as never
  }

  test("triggers summarize for anthropic non-opus-4.6 when usage exceeds 200K threshold", async () => {
    //#given - sonnet 4.5 at 180K (90% of 200K limit)
    const messages = mock(() =>
      Promise.resolve({
        data: [
          {
            info: {
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-sonnet-4-5",
              tokens: {
                input: 180000,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        ],
      })
    )
    const summarize = mock(() => Promise.resolve())
    const hook = createPreemptiveCompactionHook(createMockCtx({ messages, summarize }))
    const output = { title: "", output: "", metadata: {} }

    //#when
    await hook["tool.execute.after"](
      { tool: "Read", sessionID, callID: "call-1" },
      output
    )

    //#then
    expect(summarize).toHaveBeenCalled()
  })

  test("does not trigger summarize for opus 4.6 at 180K (well under 1M limit)", async () => {
    //#given - opus 4.6 at 180K (18% of 1M limit)
    const messages = mock(() =>
      Promise.resolve({
        data: [
          {
            info: {
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-opus-4-6",
              tokens: {
                input: 180000,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        ],
      })
    )
    const summarize = mock(() => Promise.resolve())
    const hook = createPreemptiveCompactionHook(createMockCtx({ messages, summarize }))
    const output = { title: "", output: "", metadata: {} }

    //#when
    await hook["tool.execute.after"](
      { tool: "Read", sessionID, callID: "call-opus" },
      output
    )

    //#then
    expect(summarize).not.toHaveBeenCalled()
  })

  test("triggers summarize for opus 4.6 when usage exceeds 78% of 1M", async () => {
    //#given - opus 4.6 at 800K (80% of 1M limit)
    const messages = mock(() =>
      Promise.resolve({
        data: [
          {
            info: {
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-opus-4-6",
              tokens: {
                input: 800000,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        ],
      })
    )
    const summarize = mock(() => Promise.resolve())
    const hook = createPreemptiveCompactionHook(createMockCtx({ messages, summarize }))
    const output = { title: "", output: "", metadata: {} }

    //#when
    await hook["tool.execute.after"](
      { tool: "Read", sessionID, callID: "call-opus-high" },
      output
    )

    //#then
    expect(summarize).toHaveBeenCalled()
  })

  test("triggers summarize for non-anthropic providers when usage exceeds threshold", async () => {
    //#given
    const messages = mock(() =>
      Promise.resolve({
        data: [
          {
            info: {
              role: "assistant",
              providerID: "openai",
              modelID: "gpt-5.2",
              tokens: {
                input: 180000,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        ],
      })
    )
    const summarize = mock(() => Promise.resolve())
    const hook = createPreemptiveCompactionHook(createMockCtx({ messages, summarize }))
    const output = { title: "", output: "", metadata: {} }

    //#when
    await hook["tool.execute.after"](
      { tool: "Read", sessionID, callID: "call-3" },
      output
    )

    //#then
    expect(summarize).toHaveBeenCalled()
  })

  test("does not summarize when usage is below threshold", async () => {
    // #given
    const messages = mock(() =>
      Promise.resolve({
        data: [
          {
            info: {
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-opus-4-6",
              tokens: {
                input: 100000,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        ],
      })
    )
    const summarize = mock(() => Promise.resolve())
    const hook = createPreemptiveCompactionHook(createMockCtx({ messages, summarize }))
    const output = { title: "", output: "", metadata: {} }

    // #when
    await hook["tool.execute.after"](
      { tool: "Read", sessionID, callID: "call-2" },
      output
    )

    // #then
    expect(summarize).not.toHaveBeenCalled()
  })
})
