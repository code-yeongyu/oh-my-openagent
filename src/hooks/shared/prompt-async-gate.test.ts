import { afterEach, describe, expect, test } from "bun:test"

import {
  _setPromptGateMessagesFetchTimeoutMsForTesting,
  dispatchInternalPrompt,
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "./prompt-async-gate"

describe("dispatchInternalPrompt", () => {
  afterEach(() => {
    // then
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

  test("#given async dispatch holds a session reservation #when sync mode targets the same session #then the unified service suppresses the duplicate", async () => {
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
})

describe("dispatchInternalPrompt shared gate behavior", () => {
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
    expect(second.status).toBe("reserved")
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
    expect(result.status).toBe("active")
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
    expect(result.status).toBe("active")
    expect(promptCalls).toBe(0)
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
    expect(second).toEqual({ status: "reserved", reservedBy: "team-live-delivery" })
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
    expect(second.status).toBe("failed")
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
    expect(second).toEqual({ status: "reserved", reservedBy: "test:reject:first" })
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
    expect(second).toEqual({ status: "reserved", reservedBy: "model-fallbackx:message.updated" })
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
})
