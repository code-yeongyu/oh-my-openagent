import { afterEach, describe, expect, test } from "bun:test"

import {
  promptAsyncAfterSessionIdle,
  releaseAllPromptAsyncReservationsForTesting,
} from "./prompt-async-gate"

describe("promptAsyncAfterSessionIdle", () => {
  afterEach(() => {
    // then
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given two internal promptAsync calls race for one idle session #when they dispatch concurrently #then only one prompt is accepted", async () => {
    // given
    let promptCalls = 0
    let releasePrompt: (() => void) | undefined
    const promptGate = new Promise<void>((resolve) => {
      releasePrompt = resolve
    })
    const client = {
      session: {
        status: async () => ({ data: { ses_race: { type: "idle" } } }),
        promptAsync: async () => {
          promptCalls += 1
          await promptGate
        },
      },
    }

    // when
    const first = promptAsyncAfterSessionIdle({
      client,
      sessionID: "ses_race",
      input: { path: { id: "ses_race" }, body: { parts: [] } },
      source: "test:first",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })
    await Promise.resolve()
    const second = await promptAsyncAfterSessionIdle({
      client,
      sessionID: "ses_race",
      input: { path: { id: "ses_race" }, body: { parts: [] } },
      source: "test:second",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })
    releasePrompt?.()
    const firstResult = await first

    // then
    expect(firstResult.status).toBe("dispatched")
    expect(second.status).toBe("reserved")
    expect(promptCalls).toBe(1)
  })

  test("#given session.status reports busy #when an internal promptAsync is requested #then no prompt is sent", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_busy: { type: "busy" } } }),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await promptAsyncAfterSessionIdle({
      client,
      sessionID: "ses_busy",
      input: { path: { id: "ses_busy" }, body: { parts: [] } },
      source: "test:busy",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result.status).toBe("active")
    expect(promptCalls).toBe(0)
  })
})
