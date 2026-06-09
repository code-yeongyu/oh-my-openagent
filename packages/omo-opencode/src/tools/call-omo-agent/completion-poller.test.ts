import { describe, expect, mock, test } from "bun:test"

import { waitForCompletion } from "./completion-poller"

function createToolContext(): Parameters<typeof waitForCompletion>[1] {
  return {
    sessionID: "parent-session",
    messageID: "parent-message",
    agent: "sisyphus",
    abort: new AbortController().signal,
    metadata: mock(() => {}),
  }
}

function createContext(args: {
  status: ReturnType<typeof mock>
  messages: ReturnType<typeof mock>
}): Parameters<typeof waitForCompletion>[2] {
  return {
    client: {
      session: {
        status: args.status,
        messages: args.messages,
      },
    },
  } as never
}

describe("waitForCompletion", () => {
  test("#given promptAsync returned before OpenCode saved a user message #when the child session stays idle with zero messages #then it fails as a prompt acceptance error", async () => {
    // given
    const originalDateNow = Date.now
    const originalSetTimeout = globalThis.setTimeout
    let currentTime = 0
    Date.now = () => {
      currentTime += 60_000
      return currentTime
    }
    globalThis.setTimeout = ((handler: TimerHandler) => {
      if (typeof handler === "function") {
        handler()
      }
      return originalSetTimeout(() => {}, 0)
    }) as typeof globalThis.setTimeout

    const status = mock(async () => ({ data: { "ses-undurable": { type: "idle" } } }))
    const messages = mock(async () => ({ data: [] }))

    try {
      // when
      const result = waitForCompletion(
        "ses-undurable",
        createToolContext(),
        createContext({ status, messages }),
      )

      // then
      await expect(result).rejects.toThrow("Prompt was not durably accepted by OpenCode")
      expect(messages).toHaveBeenCalled()
    } finally {
      Date.now = originalDateNow
      globalThis.setTimeout = originalSetTimeout
    }
  })

  test("#given the child session has durable messages #when it stays idle and stable #then completion succeeds", async () => {
    // given
    const originalDateNow = Date.now
    const originalSetTimeout = globalThis.setTimeout
    let currentTime = 0
    Date.now = () => {
      currentTime += 100
      return currentTime
    }
    globalThis.setTimeout = ((handler: TimerHandler) => {
      if (typeof handler === "function") {
        handler()
      }
      return originalSetTimeout(() => {}, 0)
    }) as typeof globalThis.setTimeout

    const status = mock(async () => ({ data: { "ses-complete": { type: "idle" } } }))
    const messages = mock(async () => ({
      data: [
        { info: { id: "msg-user", role: "user" } },
        { info: { id: "msg-assistant", role: "assistant" } },
      ],
    }))

    try {
      // when
      await waitForCompletion(
        "ses-complete",
        createToolContext(),
        createContext({ status, messages }),
      )

      // then
      expect(messages).toHaveBeenCalled()
    } finally {
      Date.now = originalDateNow
      globalThis.setTimeout = originalSetTimeout
    }
  })
})
