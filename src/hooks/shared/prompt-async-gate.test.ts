import { afterEach, describe, expect, test } from "bun:test"

import {
  promptAfterSessionIdle,
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

  test("#given settle is disabled and status is unavailable #when a second promptAsync starts after the first dispatch resolves #then the default dispatch hold keeps the session reserved", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const first = promptAsyncAfterSessionIdle({
      client,
      sessionID: "ses_hold_after_dispatch",
      input: { path: { id: "ses_hold_after_dispatch" }, body: { parts: [] } },
      source: "test:hold:first",
      settleMs: 0,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const second = await promptAsyncAfterSessionIdle({
      client,
      sessionID: "ses_hold_after_dispatch",
      input: { path: { id: "ses_hold_after_dispatch" }, body: { parts: [] } },
      source: "test:hold:second",
      settleMs: 0,
    })
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

  test("#given two internal prompt calls race for one idle session #when they dispatch concurrently #then only one prompt is accepted", async () => {
    // given
    let promptCalls = 0
    let releasePrompt: (() => void) | undefined
    const promptGate = new Promise<void>((resolve) => {
      releasePrompt = resolve
    })
    const client = {
      session: {
        status: async () => ({ data: { ses_prompt_race: { type: "idle" } } }),
        prompt: async () => {
          promptCalls += 1
          await promptGate
        },
      },
    }

    // when
    const first = promptAfterSessionIdle({
      client,
      sessionID: "ses_prompt_race",
      input: { path: { id: "ses_prompt_race" }, body: { parts: [] } },
      source: "test:prompt:first",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })
    await Promise.resolve()
    const second = await promptAfterSessionIdle({
      client,
      sessionID: "ses_prompt_race",
      input: { path: { id: "ses_prompt_race" }, body: { parts: [] } },
      source: "test:prompt:second",
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

  test("#given settle is disabled and status is unavailable #when a second prompt starts after the first dispatch resolves #then the default dispatch hold keeps the session reserved", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        prompt: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const first = promptAfterSessionIdle({
      client,
      sessionID: "ses_prompt_hold_after_dispatch",
      input: { path: { id: "ses_prompt_hold_after_dispatch" }, body: { parts: [] } },
      source: "test:prompt-hold:first",
      settleMs: 0,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const second = await promptAfterSessionIdle({
      client,
      sessionID: "ses_prompt_hold_after_dispatch",
      input: { path: { id: "ses_prompt_hold_after_dispatch" }, body: { parts: [] } },
      source: "test:prompt-hold:second",
      settleMs: 0,
    })
    const firstResult = await first

    // then
    expect(firstResult.status).toBe("dispatched")
    expect(second.status).toBe("reserved")
    expect(promptCalls).toBe(1)
  })
})
