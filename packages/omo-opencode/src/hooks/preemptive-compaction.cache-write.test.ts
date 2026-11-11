/// <reference types="bun-types" />

import { afterAll, describe, expect, it, mock } from "bun:test"

mock.module("../shared/logger", () => ({ log: mock(() => {}) }))

afterAll(() => {
  mock.restore()
})

const { createPreemptiveCompactionHook } = await import("./preemptive-compaction")

function createMockCtx() {
  return {
    client: {
      session: {
        messages: mock(() => Promise.resolve({ data: [] })),
        summarize: mock(() => Promise.resolve({})),
      },
      tui: { showToast: mock(() => Promise.resolve()) },
    },
    directory: "/tmp/test",
  }
}

async function finishTurn(
  hook: ReturnType<typeof createPreemptiveCompactionHook>,
  sessionID: string,
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } },
) {
  await hook.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          sessionID,
          providerID: "anthropic",
          modelID: "claude-sonnet-4-6",
          finish: true,
          tokens,
        },
      },
    },
  })
  await hook["tool.execute.after"](
    { tool: "bash", sessionID, callID: "call_1" },
    { title: "", output: "test", metadata: null },
  )
}

describe("preemptive compaction counts cache writes as prompt tokens", () => {
  // A cold-cache Anthropic turn reports most of its prompt as cache.write, not input or cache.read.
  // 33 input + 79,711 cache.read + 800,000 cache.write = 879,744 prompt tokens = 88% of the 1M window.
  it("triggers when the prompt is mostly cache writes", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never)

    await finishTurn(hook, "ses_cold_cache", {
      input: 33,
      output: 1000,
      reasoning: 0,
      cache: { read: 79_711, write: 800_000 },
    })

    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)
  })

  // 100,000 input + 100,000 cache.read + 500,000 cache.write = 700,000 = 70%, under the 78% threshold.
  it("does not trigger below the threshold when cache writes are counted", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx as never, {} as never)

    await finishTurn(hook, "ses_warm_cache", {
      input: 100_000,
      output: 1000,
      reasoning: 0,
      cache: { read: 100_000, write: 500_000 },
    })

    expect(ctx.client.session.summarize).not.toHaveBeenCalled()
  })
})
