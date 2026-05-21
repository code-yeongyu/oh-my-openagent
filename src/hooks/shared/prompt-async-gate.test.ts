import { afterEach, describe, expect, test } from "bun:test"

import {
  _setPromptGateMessagesFetchTimeoutMsForTesting,
  dispatchInternalPrompt,
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "./prompt-async-gate"

function waitForPromise<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutID: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutID = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 1_000)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutID !== undefined) {
      clearTimeout(timeoutID)
    }
  })
}

describe("dispatchInternalPrompt", () => {
  afterEach(() => {
    // then
    _setPromptGateMessagesFetchTimeoutMsForTesting(undefined)
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given async mode #when the unified prompt dispatcher runs #then promptAsync is used", async () => {
    // given
    const calls: string[] = []
    const client = {
      session: {
        promptAsync: async (input: { path: { id: string } }) => {
          calls.push(`async:${input.path.id}`)
          return { route: "async", sessionID: input.path.id }
        },
        prompt: async (input: { path: { id: string } }) => {
          calls.push(`sync:${input.path.id}`)
          return { route: "sync", sessionID: input.path.id }
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_unified_async",
      input: { path: { id: "ses_unified_async" }, body: { parts: [] } },
      source: "test:unified-async",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result).toEqual({
      status: "dispatched",
      response: { route: "async", sessionID: "ses_unified_async" },
    })
    expect(calls).toEqual(["async:ses_unified_async"])
  })

  test("#given sync mode #when the unified prompt dispatcher runs #then prompt is used", async () => {
    // given
    const calls: string[] = []
    const client = {
      session: {
        promptAsync: async (input: { path: { id: string } }) => {
          calls.push(`async:${input.path.id}`)
          return { route: "async", sessionID: input.path.id }
        },
        prompt: async (input: { path: { id: string } }) => {
          calls.push(`sync:${input.path.id}`)
          return { route: "sync", sessionID: input.path.id }
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "sync",
      client,
      sessionID: "ses_unified_sync",
      input: { path: { id: "ses_unified_sync" }, body: { parts: [] } },
      source: "test:unified-sync",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result).toEqual({
      status: "dispatched",
      response: { route: "sync", sessionID: "ses_unified_sync" },
    })
    expect(calls).toEqual(["sync:ses_unified_sync"])
  })

  test("#given async dispatch holds a session reservation #when sync mode targets the same session #then the unified service defers the duplicate", async () => {
    // given
    const calls: string[] = []
    const client = {
      session: {
        promptAsync: async () => {
          calls.push("async")
        },
        prompt: async () => {
          calls.push("sync")
        },
      },
    }

    // when
    const first = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_unified_shared_reservation",
      input: { path: { id: "ses_unified_shared_reservation" }, body: { parts: [] } },
      source: "test:unified-shared:first",
      settleMs: 0,
    })
    const second = await dispatchInternalPrompt({
      mode: "sync",
      client,
      sessionID: "ses_unified_shared_reservation",
      input: { path: { id: "ses_unified_shared_reservation" }, body: { parts: [] } },
      source: "test:unified-shared:second",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(first.status).toBe("dispatched")
    expect(second).toEqual({ status: "reserved", reservedBy: "test:unified-shared:first" })
    expect(calls).toEqual(["async"])
  })

  test("#given a busy session #when an internal prompt is dispatched #then the unified dispatcher queues and sends after idle", async () => {
    // given
    let status = "busy"
    let promptCalls = 0
    let resolvePrompt: (() => void) | undefined
    const promptSeen = new Promise<void>((resolve) => {
      resolvePrompt = resolve
    })
    const client = {
      session: {
        status: async () => ({ data: { ses_queue_busy: { type: status } } }),
        promptAsync: async () => {
          promptCalls += 1
          resolvePrompt?.()
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_queue_busy",
      input: { path: { id: "ses_queue_busy" }, body: { parts: [{ type: "text", text: "queued" }] } },
      source: "test:queue-busy",
      settleMs: 0,
      queueRetryMs: 1,
    })
    status = "idle"
    await waitForPromise(promptSeen, "queued prompt to dispatch after idle")

    // then
    expect(result.status).toBe("queued")
    expect(promptCalls).toBe(1)
  })

  test("#given duplicate queued prompts for one session #when the session becomes idle #then the dispatcher coalesces them into one prompt", async () => {
    // given
    let status = "busy"
    let promptCalls = 0
    let resolvePrompt: (() => void) | undefined
    const promptSeen = new Promise<void>((resolve) => {
      resolvePrompt = resolve
    })
    const input = { path: { id: "ses_queue_dedupe" }, body: { parts: [{ type: "text", text: "same" }] } }
    const client = {
      session: {
        status: async () => ({ data: { ses_queue_dedupe: { type: status } } }),
        promptAsync: async () => {
          promptCalls += 1
          resolvePrompt?.()
        },
      },
    }

    // when
    const first = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_queue_dedupe",
      input,
      source: "test:queue-dedupe",
      settleMs: 0,
      queueRetryMs: 1,
    })
    const second = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_queue_dedupe",
      input,
      source: "test:queue-dedupe",
      settleMs: 0,
      queueRetryMs: 1,
    })
    status = "idle"
    await waitForPromise(promptSeen, "coalesced queued prompt")

    // then
    expect(first.status).toBe("queued")
    expect(second.status).toBe("queued")
    expect(promptCalls).toBe(1)
  })

  test("#given distinct queued prompts behind a dispatch hold #when the hold is released #then the dispatcher preserves FIFO order", async () => {
    // given
    const calls: string[] = []
    let resolveSecondPrompt: (() => void) | undefined
    const secondPromptSeen = new Promise<void>((resolve) => {
      resolveSecondPrompt = resolve
    })
    const client = {
      session: {
        promptAsync: async (input: { body: { parts: Array<{ text: string }> } }) => {
          const text = input.body.parts[0]?.text
          if (text) {
            calls.push(text)
          }
          if (calls.length === 2) {
            resolveSecondPrompt?.()
          }
        },
      },
    }

    // when
    const first = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_queue_fifo",
      input: { path: { id: "ses_queue_fifo" }, body: { parts: [{ type: "text", text: "first" }] } },
      source: "test:queue-fifo:first",
      settleMs: 0,
    })
    const second = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_queue_fifo",
      input: { path: { id: "ses_queue_fifo" }, body: { parts: [{ type: "text", text: "second" }] } },
      source: "test:queue-fifo:second",
      settleMs: 0,
    })
    releasePromptAsyncReservation("ses_queue_fifo", "test:release-fifo", {
      reservedBy: "test:queue-fifo:first",
    })
    await waitForPromise(secondPromptSeen, "second queued prompt")

    // then
    expect(first.status).toBe("dispatched")
    expect(second.status).toBe("queued")
    expect(calls).toEqual(["first", "second"])
  })

  test("#given a stateful route defers queued delivery #when a dispatch hold is active #then the prompt is not queued behind the hold", async () => {
    // given
    const calls: string[] = []
    const client = {
      session: {
        promptAsync: async (input: { body: { parts: Array<{ text: string }> } }) => {
          const text = input.body.parts[0]?.text
          if (text) {
            calls.push(text)
          }
        },
      },
    }

    // when
    const first = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_queue_defer_hold",
      input: { path: { id: "ses_queue_defer_hold" }, body: { parts: [{ type: "text", text: "first" }] } },
      source: "test:queue-defer:first",
      settleMs: 0,
    })
    const second = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_queue_defer_hold",
      input: { path: { id: "ses_queue_defer_hold" }, body: { parts: [{ type: "text", text: "second" }] } },
      source: "test:queue-defer:second",
      settleMs: 0,
      queueBehavior: "defer",
    })
    releasePromptAsyncReservation("ses_queue_defer_hold", "test:queue-defer:release", {
      reservedBy: "test:queue-defer:first",
    })

    // then
    expect(first.status).toBe("dispatched")
    expect(second).toEqual({ status: "reserved", reservedBy: "test:queue-defer:first" })
    expect(calls).toEqual(["first"])
  })

  test("#given a queued prompt is waiting #when a stateful route defers queued delivery #then it does not cut ahead or enqueue", async () => {
    // given
    let status = "busy"
    const calls: string[] = []
    let resolvePrompt: (() => void) | undefined
    const promptSeen = new Promise<void>((resolve) => {
      resolvePrompt = resolve
    })
    const client = {
      session: {
        status: async () => ({ data: { ses_queue_defer_existing: { type: status } } }),
        promptAsync: async (input: { body: { parts: Array<{ text: string }> } }) => {
          const text = input.body.parts[0]?.text
          if (text) {
            calls.push(text)
          }
          resolvePrompt?.()
        },
      },
    }

    // when
    const first = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_queue_defer_existing",
      input: { path: { id: "ses_queue_defer_existing" }, body: { parts: [{ type: "text", text: "first" }] } },
      source: "test:queue-defer-existing:first",
      settleMs: 0,
      queueRetryMs: 1,
    })
    const second = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_queue_defer_existing",
      input: { path: { id: "ses_queue_defer_existing" }, body: { parts: [{ type: "text", text: "second" }] } },
      source: "test:queue-defer-existing:second",
      settleMs: 0,
      queueBehavior: "defer",
    })
    status = "idle"
    await waitForPromise(promptSeen, "first queued prompt after defer")

    // then
    expect(first.status).toBe("queued")
    expect(second).toEqual({ status: "reserved", reservedBy: "test:queue-defer-existing:first" })
    expect(calls).toEqual(["first"])
  })
})

describe("dispatchInternalPrompt shared gate behavior", () => {
  afterEach(() => {
    // then
    _setPromptGateMessagesFetchTimeoutMsForTesting(undefined)
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
    const first = dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_race",
      input: { path: { id: "ses_race" }, body: { parts: [] } },
      source: "test:first",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })
    await Promise.resolve()
    const second = await dispatchInternalPrompt({
      mode: "async",
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
    expect(second.status).toBe("queued")
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
    const first = dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_hold_after_dispatch",
      input: { path: { id: "ses_hold_after_dispatch" }, body: { parts: [] } },
      source: "test:hold:first",
      settleMs: 0,
    })
    const firstResult = await first
    const second = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_hold_after_dispatch",
      input: { path: { id: "ses_hold_after_dispatch" }, body: { parts: [] } },
      source: "test:hold:second",
      settleMs: 0,
    })

    // then
    expect(firstResult.status).toBe("dispatched")
    expect(second.status).toBe("queued")
    expect(promptCalls).toBe(1)
  })

  test("#given SDK promptAsync depends on its session receiver #when the gate dispatches #then method binding is preserved", async () => {
    // given
    const session = {
      _client: { accepted: true },
      async promptAsync(
        this: { _client: { accepted: boolean } },
        input: { path: { id: string }, body: { parts: unknown[] } },
      ) {
        return { accepted: this._client.accepted, sessionID: input.path.id }
      },
    }
    const client = { session }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_bound_prompt_async",
      input: { path: { id: "ses_bound_prompt_async" }, body: { parts: [] } },
      source: "test:bound-prompt-async",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result).toEqual({
      status: "dispatched",
      response: { accepted: true, sessionID: "ses_bound_prompt_async" },
    })
  })

  test("#given SDK messages depends on its session receiver #when latest assistant waits on tools #then method binding is preserved and no prompt is sent", async () => {
    // given
    let promptCalls = 0
    const session = {
      _client: {
        messages: [
          {
            info: { id: "msg_user", role: "user" },
            parts: [{ type: "text", text: "run work" }],
          },
          {
            info: { id: "msg_assistant", role: "assistant", finish: "tool-calls" },
            parts: [{ type: "tool_use", id: "toolu_pending", state: { status: "running" } }],
          },
        ],
      },
      async messages(
        this: { _client: { messages: unknown[] } },
        _input: { path: { id: string }; query: { directory: string } },
      ) {
        return { data: this._client.messages }
      },
      async promptAsync() {
        promptCalls += 1
      },
    }
    const client = { session }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_bound_messages",
      input: { path: { id: "ses_bound_messages" }, body: { parts: [] } },
      source: "test:bound-messages",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result.status).toBe("queued")
    expect(promptCalls).toBe(0)
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
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_busy",
      input: { path: { id: "ses_busy" }, body: { parts: [] } },
      source: "test:busy",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result.status).toBe("queued")
    expect(promptCalls).toBe(0)
  })

  test("#given latest assistant turn is waiting on tools #when an internal promptAsync is requested #then no prompt is sent", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_waiting_tools: { type: "idle" } } }),
        messages: async () => ({
          data: [
            {
              info: { id: "msg_user", role: "user" },
              parts: [{ type: "text", text: "run work" }],
            },
            {
              info: { id: "msg_assistant", role: "assistant", finish: "tool-calls" },
              parts: [{ type: "tool_use", id: "toolu_pending", state: { status: "pending" } }],
            },
          ],
        }),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_waiting_tools",
      input: { path: { id: "ses_waiting_tools" }, body: { parts: [] } },
      source: "test:waiting-tools",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result.status).toBe("queued")
    expect(promptCalls).toBe(0)
  })

  test("#given latest assistant turn has a tool-calls finish without pending part state #when an internal promptAsync is requested #then no prompt is sent", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_finish_waiting_tools: { type: "idle" } } }),
        messages: async () => ({
          data: [
            {
              info: { id: "msg_user", role: "user" },
              parts: [{ type: "text", text: "run work" }],
            },
            {
              info: { id: "msg_assistant", role: "assistant", finish: "tool-calls" },
              parts: [{ type: "tool_use", id: "toolu_pending" }],
            },
          ],
        }),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_finish_waiting_tools",
      input: { path: { id: "ses_finish_waiting_tools" }, body: { parts: [] } },
      source: "test:finish-waiting-tools",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result.status).toBe("queued")
    expect(promptCalls).toBe(0)
  })

  test("#given latest assistant turn has a running tool-call part #when an internal promptAsync is requested #then no prompt is sent", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_tool_call_part: { type: "idle" } } }),
        messages: async () => ({
          data: [
            {
              info: { id: "msg_user", role: "user" },
              parts: [{ type: "text", text: "run work" }],
            },
            {
              info: { id: "msg_assistant", role: "assistant" },
              parts: [{ type: "tool-call", id: "call_pending", state: { status: "running" } }],
            },
          ],
        }),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_tool_call_part",
      input: { path: { id: "ses_tool_call_part" }, body: { parts: [] } },
      source: "test:tool-call-part",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result.status).toBe("queued")
    expect(promptCalls).toBe(0)
  })

  test("#given latest assistant turn is still streaming without a finish reason #when an internal promptAsync is requested #then no prompt is sent", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_streaming_assistant: { type: "idle" } } }),
        messages: async () => ({
          data: [
            {
              info: { id: "msg_user", role: "user" },
              parts: [{ type: "text", text: "run work" }],
            },
            {
              info: { id: "msg_assistant", role: "assistant" },
              parts: [{ type: "reasoning", text: "still thinking" }],
            },
          ],
        }),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_streaming_assistant",
      input: { path: { id: "ses_streaming_assistant" }, body: { parts: [] } },
      source: "test:streaming-assistant",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result.status).toBe("queued")
    expect(promptCalls).toBe(0)
  })

  test("#given latest assistant turn has unknown finish #when an internal promptAsync is requested #then no prompt is sent", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_unknown_finish: { type: "idle" } } }),
        messages: async () => ({
          data: [
            {
              info: { id: "msg_user", role: "user" },
              parts: [{ type: "text", text: "run work" }],
            },
            {
              info: { id: "msg_assistant", role: "assistant", finish: "unknown" },
              parts: [{ type: "reasoning", text: "still resolving" }],
            },
          ],
        }),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_unknown_finish",
      input: { path: { id: "ses_unknown_finish" }, body: { parts: [] } },
      source: "test:unknown-finish",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result.status).toBe("queued")
    expect(promptCalls).toBe(0)
  })

  test("#given latest assistant turn has boolean finish === true #when checking blocks #then it is treated as terminal (NOT blocking)", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_boolean_finish: { type: "idle" } } }),
        messages: async () => ({
          data: [
            {
              info: { id: "msg_user", role: "user" },
              parts: [{ type: "text", text: "run work" }],
            },
            {
              info: { id: "msg_assistant", role: "assistant", finish: true },
              parts: [{ type: "text", text: "done" }],
            },
          ],
        }),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_boolean_finish",
      input: { path: { id: "ses_boolean_finish" }, body: { parts: [] } },
      source: "test:boolean-finish",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result.status).toBe("dispatched")
    expect(promptCalls).toBe(1)
  })

  test("#given latest assistant turn has info.time.completed but no finish field #when checking blocks #then it is treated as terminal", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_completed_time: { type: "idle" } } }),
        messages: async () => ({
          data: [
            {
              info: { id: "msg_user", role: "user" },
              parts: [{ type: "text", text: "run work" }],
            },
            {
              info: { id: "msg_assistant", role: "assistant", time: { completed: 1_762_000_000_000 } },
              parts: [{ type: "text", text: "done" }],
            },
          ],
        }),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_completed_time",
      input: { path: { id: "ses_completed_time" }, body: { parts: [] } },
      source: "test:completed-time",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result.status).toBe("dispatched")
    expect(promptCalls).toBe(1)
  })

  test("#given internal user tail follows an assistant waiting on tools #when an internal promptAsync is requested #then no prompt is sent", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_internal_tail_tools: { type: "idle" } } }),
        messages: async () => ({
          data: [
            {
              info: { id: "msg_user", role: "user" },
              parts: [{ type: "text", text: "run work" }],
            },
            {
              info: { id: "msg_assistant", role: "assistant", finish: "tool-calls" },
              parts: [{ type: "tool_use", id: "toolu_pending", state: { status: "running" } }],
            },
            {
              info: { id: "msg_internal_user", role: "user" },
              parts: [{ type: "text", text: "wake\n<!-- OMO_INTERNAL_INITIATOR -->" }],
            },
          ],
        }),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_internal_tail_tools",
      input: { path: { id: "ses_internal_tail_tools" }, body: { parts: [] } },
      source: "test:internal-tail-tools",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result.status).toBe("queued")
    expect(promptCalls).toBe(0)
  })

  test("#given synthetic user tail follows an assistant waiting on tools #when an internal promptAsync is requested #then no prompt is sent", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_synthetic_tail_tools: { type: "idle" } } }),
        messages: async () => ({
          data: [
            {
              info: { id: "msg_user", role: "user" },
              parts: [{ type: "text", text: "run work" }],
            },
            {
              info: { id: "msg_assistant", role: "assistant", finish: "tool-calls" },
              parts: [{ type: "tool_use", id: "toolu_pending", state: { status: "running" } }],
            },
            {
              info: { id: "msg_synthetic_user", role: "user" },
              parts: [{ type: "text", text: "continue", synthetic: true }],
            },
          ],
        }),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_synthetic_tail_tools",
      input: { path: { id: "ses_synthetic_tail_tools" }, body: { parts: [] } },
      source: "test:synthetic-tail-tools",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result.status).toBe("queued")
    expect(promptCalls).toBe(0)
  })

  test("#given mixed real user tail follows an assistant waiting on tools #when an internal promptAsync is requested #then promptAsync is sent", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_mixed_tail_tools: { type: "idle" } } }),
        messages: async () => ({
          data: [
            {
              info: { id: "msg_user", role: "user" },
              parts: [{ type: "text", text: "run work" }],
            },
            {
              info: { id: "msg_assistant", role: "assistant", finish: "tool-calls" },
              parts: [{ type: "tool_use", id: "toolu_pending", state: { status: "running" } }],
            },
            {
              info: { id: "msg_mixed_user", role: "user" },
              parts: [
                { type: "text", text: "wake\n<!-- OMO_INTERNAL_INITIATOR -->" },
                { type: "text", text: "real user follow-up" },
              ],
            },
          ],
        }),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_mixed_tail_tools",
      input: { path: { id: "ses_mixed_tail_tools" }, body: { parts: [] } },
      source: "test:mixed-tail-tools",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result.status).toBe("dispatched")
    expect(promptCalls).toBe(1)
  })

  test("#given latest assistant turn is waiting on tools #when tool-state check is disabled #then promptAsync is sent", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_recovery_tools: { type: "idle" } } }),
        messages: async () => ({
          data: [{
            info: { id: "msg_assistant", role: "assistant", finish: "tool-calls" },
            parts: [{ type: "tool_use", id: "toolu_pending", state: { status: "pending" } }],
          }],
        }),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_recovery_tools",
      input: { path: { id: "ses_recovery_tools" }, body: { parts: [] } },
      source: "test:recovery-tools",
      settleMs: 0,
      postDispatchHoldMs: 0,
      checkToolState: false,
    })

    // then
    expect(result.status).toBe("dispatched")
    expect(promptCalls).toBe(1)
  })

  test("#given latest-message fetch hangs #when an internal promptAsync is requested #then the tool-state check times out and dispatch continues", async () => {
    // given
    _setPromptGateMessagesFetchTimeoutMsForTesting(5)
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_messages_hang: { type: "idle" } } }),
        messages: async () => new Promise(() => {}),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_messages_hang",
      input: { path: { id: "ses_messages_hang" }, body: { parts: [] } },
      source: "test:messages-hang",
      settleMs: 0,
      postDispatchHoldMs: 0,
      dispatchTimeoutMs: 50,
    })

    // then
    expect(result.status).toBe("dispatched")
    expect(promptCalls).toBe(1)
  })

  test("#given dispatch hold has expired #when the same session prompts again #then the next promptAsync is accepted", async () => {
    // given
    let promptCalls = 0
    const originalDateNow = Date.now
    let currentNow = originalDateNow()
    Date.now = () => currentNow
    const client = {
      session: {
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    try {
      // when
      const first = await dispatchInternalPrompt({
      mode: "async",
        client,
        sessionID: "ses_expired_hold",
        input: { path: { id: "ses_expired_hold" }, body: { parts: [] } },
        source: "test:expired:first",
        settleMs: 0,
        postDispatchHoldMs: 1,
      })
      currentNow += 2
      const second = await dispatchInternalPrompt({
      mode: "async",
        client,
        sessionID: "ses_expired_hold",
        input: { path: { id: "ses_expired_hold" }, body: { parts: [] } },
        source: "test:expired:second",
        settleMs: 0,
        postDispatchHoldMs: 0,
      })

      // then
      expect(first.status).toBe("dispatched")
      expect(second.status).toBe("dispatched")
      expect(promptCalls).toBe(2)
    } finally {
      Date.now = originalDateNow
    }
  })

  test("#given a peer-message promptAsync hold #when an unrelated route releases the session #then the peer-message hold remains reserved", async () => {
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
    const first = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_release_scope",
      input: {
        path: { id: "ses_release_scope" },
        body: {
          parts: [{ type: "text", text: '<peer_message from="teammate">hello</peer_message>' }],
        },
      },
      source: "team-live-delivery",
      settleMs: 0,
    })
    releasePromptAsyncReservation("ses_release_scope", "ralph-loop:activity")
    const second = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_release_scope",
      input: {
        path: { id: "ses_release_scope" },
        body: { parts: [{ type: "text", text: "continue" }] },
      },
      source: "todo-continuation-enforcer",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(first.status).toBe("dispatched")
    expect(second).toEqual({ status: "queued", queuedBy: "team-live-delivery", position: 1 })
    expect(promptCalls).toBe(1)
  })

  test("#given a route family promptAsync hold #when the same family aborts another source #then the reservation is released", async () => {
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
    const first = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_release_family_scope",
      input: {
        path: { id: "ses_release_family_scope" },
        body: { parts: [{ type: "text", text: "continue" }] },
      },
      source: "model-fallback:message.updated",
      settleMs: 0,
    })
    const released = releasePromptAsyncReservation(
      "ses_release_family_scope",
      "model-fallback-abort:session.error",
      { reservedByPrefix: "model-fallback:" },
    )
    const second = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_release_family_scope",
      input: {
        path: { id: "ses_release_family_scope" },
        body: { parts: [{ type: "text", text: "continue again" }] },
      },
      source: "model-fallback:session.error",
      settleMs: 0,
    })

    // then
    expect(first.status).toBe("dispatched")
    expect(released).toBe(true)
    expect(second.status).toBe("dispatched")
    expect(promptCalls).toBe(2)
  })

  test("#given promptAsync dispatch never settles #when dispatch timeout elapses #then reservation is released for the next caller", async () => {
    // given
    let promptCalls = 0
    const neverSettles = new Promise<void>(() => {})
    const client = {
      session: {
        promptAsync: async () => {
          promptCalls += 1
          await neverSettles
        },
      },
    }

    // when
    const first = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_dispatch_timeout",
      input: { path: { id: "ses_dispatch_timeout" }, body: { parts: [] } },
      source: "test:timeout:first",
      settleMs: 0,
      dispatchTimeoutMs: 1,
      postDispatchHoldMs: 0,
    })
    const second = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_dispatch_timeout",
      input: { path: { id: "ses_dispatch_timeout" }, body: { parts: [] } },
      source: "test:timeout:second",
      settleMs: 0,
      dispatchTimeoutMs: 1,
      postDispatchHoldMs: 0,
    })

    // then
    expect(first.status).toBe("failed")
    expect(first).toMatchObject({ dispatchAttempted: true })
    expect(second.status).toBe("failed")
    expect(second).toMatchObject({ dispatchAttempted: true })
    expect(promptCalls).toBe(2)
  })

  test("#given promptAsync rejects after dispatch #when a second caller races immediately #then post-dispatch hold still blocks duplicate", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        promptAsync: async () => {
          promptCalls += 1
          throw new Error("post-dispatch failure")
        },
      },
    }

    // when
    const first = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_post_dispatch_reject",
      input: { path: { id: "ses_post_dispatch_reject" }, body: { parts: [] } },
      source: "test:reject:first",
      settleMs: 0,
    })
    const second = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_post_dispatch_reject",
      input: { path: { id: "ses_post_dispatch_reject" }, body: { parts: [] } },
      source: "test:reject:second",
      settleMs: 0,
    })

    // then
    expect(first.status).toBe("failed")
    expect(first).toMatchObject({ dispatchAttempted: true })
    expect(second).toEqual({ status: "queued", queuedBy: "test:reject:first", position: 1 })
    expect(promptCalls).toBe(1)
  })

  test("#given a similarly named sibling route #when reservedByPrefix uses a strict family prefix #then release does not clear sibling reservation", async () => {
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
    const first = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_prefix_sibling",
      input: {
        path: { id: "ses_prefix_sibling" },
        body: { parts: [{ type: "text", text: "continue" }] },
      },
      source: "model-fallbackx:message.updated",
      settleMs: 0,
    })
    const released = releasePromptAsyncReservation(
      "ses_prefix_sibling",
      "model-fallback-abort:session.error",
      { reservedByPrefix: "model-fallback:" },
    )
    const second = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_prefix_sibling",
      input: {
        path: { id: "ses_prefix_sibling" },
        body: { parts: [{ type: "text", text: "continue again" }] },
      },
      source: "model-fallback:session.error",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(first.status).toBe("dispatched")
    expect(released).toBe(false)
    expect(second).toEqual({ status: "queued", queuedBy: "model-fallbackx:message.updated", position: 1 })
    expect(promptCalls).toBe(1)
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
    const first = dispatchInternalPrompt({ mode: "sync", client,
    sessionID: "ses_prompt_race",
    input: { path: { id: "ses_prompt_race" }, body: { parts: [] } },
    source: "test:prompt:first",
    settleMs: 0,
    postDispatchHoldMs: 0, })
    await Promise.resolve()
    const second = await dispatchInternalPrompt({ mode: "sync", client,
    sessionID: "ses_prompt_race",
    input: { path: { id: "ses_prompt_race" }, body: { parts: [] } },
    source: "test:prompt:second",
    settleMs: 0,
    postDispatchHoldMs: 0, })
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
    const first = dispatchInternalPrompt({ mode: "sync", client,
    sessionID: "ses_prompt_hold_after_dispatch",
    input: { path: { id: "ses_prompt_hold_after_dispatch" }, body: { parts: [] } },
    source: "test:prompt-hold:first",
    settleMs: 0, })
    const firstResult = await first
    const second = await dispatchInternalPrompt({ mode: "sync", client,
    sessionID: "ses_prompt_hold_after_dispatch",
    input: { path: { id: "ses_prompt_hold_after_dispatch" }, body: { parts: [] } },
    source: "test:prompt-hold:second",
    settleMs: 0, })

    // then
    expect(firstResult.status).toBe("dispatched")
    expect(second.status).toBe("reserved")
    expect(promptCalls).toBe(1)
  })

  test("#given session.status never resolves #when promptAsync is requested #then isSessionActive times out and dispatch is attempted", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        status: async () => new Promise(() => {}),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_status_hang",
      input: { path: { id: "ses_status_hang" }, body: { parts: [] } },
      source: "test:status-hang",
      settleMs: 0,
      postDispatchHoldMs: 0,
      dispatchTimeoutMs: 50,
    })

    // then
    expect(result.status).toBe("dispatched")
    expect(promptCalls).toBe(1)
  }, 2000)

  test("#given SDK prompt depends on its session receiver #when the gate dispatches #then method binding is preserved", async () => {
    // given
    const session = {
      _client: { accepted: true },
      async prompt(
        this: { _client: { accepted: boolean } },
        input: { path: { id: string }, body: { parts: unknown[] } },
      ) {
        return { accepted: this._client.accepted, sessionID: input.path.id }
      },
    }
    const client = { session }

    // when
    const result = await dispatchInternalPrompt({ mode: "sync", client,
    sessionID: "ses_bound_prompt",
    input: { path: { id: "ses_bound_prompt" }, body: { parts: [] } },
    source: "test:bound-prompt",
    settleMs: 0,
    postDispatchHoldMs: 0, })

    // then
    expect(result).toEqual({
      status: "dispatched",
      response: { accepted: true, sessionID: "ses_bound_prompt" },
    })
  })

  test("#given session.status hangs forever #when promptAsync gate checks activity #then it dispatches after status timeout", { timeout: 10_000 }, async () => {
    // given
    let promptCalls = 0
    const neverSettles = new Promise<never>(() => {})
    const client = {
      session: {
        status: () => neverSettles,
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await promptAsyncAfterSessionIdle({
      client,
      sessionID: "ses_status_timeout",
      input: { path: { id: "ses_status_timeout" }, body: { parts: [] } },
      source: "test:status-timeout",
      settleMs: 0,
      postDispatchHoldMs: 0,
    })

    // then
    expect(result.status).toBe("dispatched")
    expect(promptCalls).toBe(1)
  })
})
