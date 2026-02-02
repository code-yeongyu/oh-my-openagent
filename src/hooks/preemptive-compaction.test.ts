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

  test("triggers summarize when usage exceeds threshold", async () => {
    // #given
    const messages = mock(() =>
      Promise.resolve({
        data: [
          {
            info: {
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-opus-4-5",
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

    // #when
    await hook["tool.execute.after"](
      { tool: "Read", sessionID, callID: "call-1" },
      output
    )

    // #then
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
              modelID: "claude-opus-4-5",
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
