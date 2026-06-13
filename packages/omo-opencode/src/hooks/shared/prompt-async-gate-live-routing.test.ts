/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"

import { subagentSessions } from "../../features/claude-code-session-state/state"
import {
  _setFetchImplementationForTesting,
  _setLiveClientForTesting,
  initLiveServerRoute,
  resetLiveServerRouteForTesting,
  setLiveParentWakeRoutingDisabled,
} from "../../shared/live-server-route"
import {
  dispatchInternalPrompt,
  releaseAllPromptAsyncReservationsForTesting,
} from "../../shared/prompt-async-gate"

function makeRecordingSession() {
  const calls: string[] = []
  const session = {
    async status(this: unknown) {
      calls.push("status")
      return {}
    },
    async messages(this: unknown, _input: unknown) {
      calls.push("messages")
      return { data: [] }
    },
    async promptAsync(this: unknown, _input: unknown) {
      calls.push("promptAsync")
      return { ok: true }
    },
  }
  return { session, calls }
}

function makeClient(session: ReturnType<typeof makeRecordingSession>["session"]) {
  return { session }
}

function makeFakeFetch200() {
  return async (_url: unknown, _opts?: unknown): Promise<Response> => {
    return new Response(JSON.stringify([]), { status: 200 })
  }
}

function makeBaseDispatchArgs(sessionID: string, client: unknown) {
  return {
    mode: "async" as const,
    client: client as Parameters<typeof dispatchInternalPrompt>[0]["client"],
    sessionID,
    input: { path: { id: sessionID }, body: { parts: [{ type: "text", text: "hi" }] } },
    source: "test:live-routing",
    settleMs: 0,
    postDispatchHoldMs: 0,
    checkStatus: false,
    checkToolState: false,
  }
}

describe("dispatchInternalPrompt live-server-route routing", () => {
  afterEach(() => {
    //#then
    releaseAllPromptAsyncReservationsForTesting()
    resetLiveServerRouteForTesting()
  })

  test("#given registered inProcessClient and live route available #when dispatchInternalPrompt runs #then promptAsync is called on the live client not the original", async () => {
    //#given
    const origSession = makeRecordingSession()
    const liveSession = makeRecordingSession()
    const orig = makeClient(origSession.session)
    const live = makeClient(liveSession.session)
    _setFetchImplementationForTesting(makeFakeFetch200() as typeof fetch)
    initLiveServerRoute({ serverUrl: new URL("http://127.0.0.1:9999"), directory: "/test", inProcessClient: orig })
    _setLiveClientForTesting(live)

    //#when
    const result = await dispatchInternalPrompt(makeBaseDispatchArgs("ses_live_dispatch", orig))

    //#then
    expect(result.status).toBe("dispatched")
    expect(liveSession.calls).toContain("promptAsync")
    expect(origSession.calls).not.toContain("promptAsync")
  })

  test("#given registered inProcessClient and live route available #when dispatchInternalPrompt runs #then status and messages are read on the live client", async () => {
    //#given
    const origSession = makeRecordingSession()
    const liveSession = makeRecordingSession()
    const orig = makeClient(origSession.session)
    const live = makeClient(liveSession.session)
    _setFetchImplementationForTesting(makeFakeFetch200() as typeof fetch)
    initLiveServerRoute({ serverUrl: new URL("http://127.0.0.1:9999"), directory: "/test", inProcessClient: orig })
    _setLiveClientForTesting(live)

    //#when
    await dispatchInternalPrompt({
      ...makeBaseDispatchArgs("ses_live_reads", orig),
      checkStatus: true,
      checkToolState: true,
    })

    //#then
    expect(origSession.calls).not.toContain("status")
    expect(origSession.calls).not.toContain("messages")
  })

  test("#given a child session in subagentSessions #when dispatchInternalPrompt runs #then the original client is used and live client is untouched", async () => {
    //#given
    const origSession = makeRecordingSession()
    const liveSession = makeRecordingSession()
    const orig = makeClient(origSession.session)
    const live = makeClient(liveSession.session)
    _setFetchImplementationForTesting(makeFakeFetch200() as typeof fetch)
    initLiveServerRoute({ serverUrl: new URL("http://127.0.0.1:9999"), directory: "/test", inProcessClient: orig })
    _setLiveClientForTesting(live)
    subagentSessions.add("ses_child")

    //#when
    const result = await dispatchInternalPrompt(makeBaseDispatchArgs("ses_child", orig))

    //#then
    expect(result.status).toBe("dispatched")
    expect(origSession.calls).toContain("promptAsync")
    expect(liveSession.calls).not.toContain("promptAsync")
  })

  test("#given an unregistered client #when dispatchInternalPrompt runs #then the original client is used and no probe fetch is made", async () => {
    //#given
    const origSession = makeRecordingSession()
    const unregisteredSession = makeRecordingSession()
    const unregistered = makeClient(unregisteredSession.session)
    let fetchCallCount = 0
    _setFetchImplementationForTesting((async (_url: unknown, _opts?: unknown) => {
      fetchCallCount += 1
      return new Response(JSON.stringify([]), { status: 200 })
    }) as typeof fetch)
    initLiveServerRoute({ serverUrl: new URL("http://127.0.0.1:9999"), directory: "/test", inProcessClient: makeClient(origSession.session) })

    //#when
    const result = await dispatchInternalPrompt(makeBaseDispatchArgs("ses_unregistered", unregistered))

    //#then
    expect(result.status).toBe("dispatched")
    expect(unregisteredSession.calls).toContain("promptAsync")
    expect(fetchCallCount).toBe(0)
  })

  test("#given live routing is disabled via setLiveParentWakeRoutingDisabled #when dispatchInternalPrompt runs #then the original client is used", async () => {
    //#given
    const origSession = makeRecordingSession()
    const liveSession = makeRecordingSession()
    const orig = makeClient(origSession.session)
    const live = makeClient(liveSession.session)
    _setFetchImplementationForTesting(makeFakeFetch200() as typeof fetch)
    initLiveServerRoute({ serverUrl: new URL("http://127.0.0.1:9999"), directory: "/test", inProcessClient: orig })
    _setLiveClientForTesting(live)
    setLiveParentWakeRoutingDisabled(true)

    //#when
    const result = await dispatchInternalPrompt(makeBaseDispatchArgs("ses_flag_disabled", orig))

    //#then
    expect(result.status).toBe("dispatched")
    expect(origSession.calls).toContain("promptAsync")
    expect(liveSession.calls).not.toContain("promptAsync")
  })

  test("#given live dispatch rejects with a pre-send connection failure #when dispatchInternalPrompt runs #then fallback dispatches exactly once on original client and route is marked unavailable", async () => {
    //#given
    let liveCalls = 0
    let origCalls = 0
    const connError = Object.assign(new TypeError("fetch failed"), { code: "ECONNREFUSED" })
    const liveSession = {
      async promptAsync(_input: unknown) {
        liveCalls += 1
        throw connError
      },
    }
    const origSession = {
      async promptAsync(_input: unknown) {
        origCalls += 1
        return { ok: true }
      },
    }
    const orig = { session: origSession }
    const live = { session: liveSession }
    _setFetchImplementationForTesting(makeFakeFetch200() as typeof fetch)
    initLiveServerRoute({ serverUrl: new URL("http://127.0.0.1:9999"), directory: "/test", inProcessClient: orig })
    _setLiveClientForTesting(live)

    //#when
    const result = await dispatchInternalPrompt(makeBaseDispatchArgs("ses_fallback_conn", orig))

    //#then
    expect(result.status).toBe("dispatched")
    expect(liveCalls).toBe(1)
    expect(origCalls).toBe(1)
  })

  test("#given live dispatch hangs past dispatchTimeoutMs #when dispatchInternalPrompt runs #then result is failed with timeout error original client is not called and route is marked unavailable", async () => {
    //#given
    let liveCalls = 0
    let origCalls = 0
    const neverSettles = new Promise<never>(() => {})
    const liveSession = {
      async promptAsync(_input: unknown) {
        liveCalls += 1
        await neverSettles
        return { ok: true }
      },
    }
    const origSession = {
      async promptAsync(_input: unknown) {
        origCalls += 1
        return { ok: true }
      },
    }
    const orig = { session: origSession }
    const live = { session: liveSession }
    _setFetchImplementationForTesting(makeFakeFetch200() as typeof fetch)
    initLiveServerRoute({ serverUrl: new URL("http://127.0.0.1:9999"), directory: "/test", inProcessClient: orig })
    _setLiveClientForTesting(live)

    //#when
    const result = await dispatchInternalPrompt({
      ...makeBaseDispatchArgs("ses_timeout_live", orig),
      dispatchTimeoutMs: 50,
    })

    //#then
    expect(result.status).toBe("failed")
    expect(liveCalls).toBe(1)
    expect(origCalls).toBe(0)
    if (result.status === "failed") {
      const errMsg = result.error instanceof Error ? result.error.message : String(result.error)
      expect(errMsg).toMatch(/\[prompt-async-gate\] promptAsync dispatch/)
    }
  }, 5_000)

  test("#given live route active and queueBehavior enqueue #when session is initially busy then becomes idle #then queued entry dispatches via live client", async () => {
    //#given
    let status = "busy"
    let liveCalls = 0
    let origCalls = 0
    let resolvePrompt: (() => void) | undefined
    const promptSeen = new Promise<void>((resolve) => {
      resolvePrompt = resolve
    })
    const liveSession = {
      async status(_input?: unknown) {
        return { data: { ses_queue_live: { type: status } } }
      },
      async promptAsync(_input: unknown) {
        liveCalls += 1
        resolvePrompt?.()
        return { ok: true }
      },
    }
    const origSession = {
      async status(_input?: unknown) {
        return { data: { ses_queue_live: { type: status } } }
      },
      async promptAsync(_input: unknown) {
        origCalls += 1
        return { ok: true }
      },
    }
    const orig = { session: origSession }
    const live = { session: liveSession }
    _setFetchImplementationForTesting(makeFakeFetch200() as typeof fetch)
    initLiveServerRoute({ serverUrl: new URL("http://127.0.0.1:9999"), directory: "/test", inProcessClient: orig })
    _setLiveClientForTesting(live)

    //#when
    const result = await dispatchInternalPrompt({
      ...makeBaseDispatchArgs("ses_queue_live", orig),
      checkStatus: true,
      checkToolState: false,
      queueBehavior: "enqueue",
      queueRetryMs: 1,
    })
    status = "idle"
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error("timed out waiting for queued prompt")), 2_000)
      promptSeen.then(() => {
        clearTimeout(timeoutId)
        resolve()
      }).catch(reject)
    })

    //#then
    expect(result.status).toBe("queued")
    expect(liveCalls).toBe(1)
    expect(origCalls).toBe(0)
  }, 5_000)
})
