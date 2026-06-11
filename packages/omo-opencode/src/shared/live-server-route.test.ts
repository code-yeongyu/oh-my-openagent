import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { subagentSessions } from "../features/claude-code-session-state/state"
import {
  LIVE_ROUTE_DISPATCH_LOG,
  LIVE_ROUTE_UNAVAILABLE_LOG,
  _setLiveClientForTesting,
  _setFetchImplementationForTesting,
  initLiveServerRoute,
  isPreSendConnectionFailure,
  markLiveRouteUnavailable,
  resetLiveServerRouteForTesting,
  resolveDispatchClient,
  tryResolveDispatchClientSync,
  warmLiveServerProbe,
  setLiveParentWakeRoutingDisabled,
} from "./live-server-route"

type FakeFetchResponse = {
  ok: boolean
  status: number
}

function makeFakeFetch(responses: FakeFetchResponse[], { delay = 0 }: { delay?: number } = {}): {
  fetch: typeof fetch
  callCount: () => number
} {
  let calls = 0
  let idx = 0
  const fake = async (_url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    calls++
    if (delay > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay))
    }
    const resp = responses[idx] ?? responses[responses.length - 1]
    if (resp) idx++
    return { ok: resp?.ok ?? false, status: resp?.status ?? 500 } as Response
  }
  return { fetch: fake as unknown as typeof fetch, callCount: () => calls }
}

function makeNeverResolvingFetch(): {
  fetch: typeof fetch
  callCount: () => number
} {
  let calls = 0
  const fake = (_url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    calls++
    return new Promise<Response>(() => undefined)
  }
  return { fetch: fake as unknown as typeof fetch, callCount: () => calls }
}

const FAKE_SERVER_URL = new URL("http://127.0.0.1:19999")

const fakeInProcessClient = { _marker: "in-process" } as unknown
const fakeLiveClient = { _marker: "live" } as unknown

describe("live-server-route", () => {
  beforeEach(() => {
    resetLiveServerRouteForTesting()
    setLiveParentWakeRoutingDisabled(false)
    _setFetchImplementationForTesting(undefined)
    _setLiveClientForTesting(undefined)
    subagentSessions.clear()
  })

  afterEach(() => {
    resetLiveServerRouteForTesting()
    setLiveParentWakeRoutingDisabled(false)
    _setFetchImplementationForTesting(undefined)
    _setLiveClientForTesting(undefined)
    subagentSessions.clear()
  })

  describe("resolveDispatchClient — identity passthrough", () => {
    test("#given different client object #when resolveDispatchClient called #then returns in-process without probing", async () => {
      //#given
      const { fetch: fakeFetch, callCount } = makeFakeFetch([{ ok: true, status: 200 }])
      _setFetchImplementationForTesting(fakeFetch)
      initLiveServerRoute({ serverUrl: FAKE_SERVER_URL, directory: "/tmp/test", inProcessClient: fakeInProcessClient })

      const differentClient = { _marker: "different" } as unknown

      //#when
      const result = await resolveDispatchClient(differentClient, "ses_identity")

      //#then
      expect(result.route).toBe("in-process")
      expect(result.client).toBe(differentClient)
      expect(callCount()).toBe(0)
    })
  })

  describe("resolveDispatchClient — flag disabled passthrough", () => {
    test("#given live routing flag disabled #when resolveDispatchClient called with in-process client #then returns in-process without probing", async () => {
      //#given
      const { fetch: fakeFetch, callCount } = makeFakeFetch([{ ok: true, status: 200 }])
      _setFetchImplementationForTesting(fakeFetch)
      initLiveServerRoute({ serverUrl: FAKE_SERVER_URL, directory: "/tmp/test", inProcessClient: fakeInProcessClient })
      setLiveParentWakeRoutingDisabled(true)

      //#when
      const result = await resolveDispatchClient(fakeInProcessClient, "ses_flag")

      //#then
      expect(result.route).toBe("in-process")
      expect(callCount()).toBe(0)
    })
  })

  describe("resolveDispatchClient — child session passthrough", () => {
    test("#given sessionID in subagentSessions #when resolveDispatchClient called #then returns in-process without probing", async () => {
      //#given
      const { fetch: fakeFetch, callCount } = makeFakeFetch([{ ok: true, status: 200 }])
      _setFetchImplementationForTesting(fakeFetch)
      initLiveServerRoute({ serverUrl: FAKE_SERVER_URL, directory: "/tmp/test", inProcessClient: fakeInProcessClient })
      subagentSessions.add("ses_child_123")

      //#when
      const result = await resolveDispatchClient(fakeInProcessClient, "ses_child_123")

      //#then
      expect(result.route).toBe("in-process")
      expect(callCount()).toBe(0)
    })
  })

  describe("resolveDispatchClient — 200 probe → live + client cached", () => {
    test("#given probe returns 200 #when resolveDispatchClient called twice #then returns live route and caches same client object", async () => {
      //#given
      const { fetch: fakeFetch, callCount } = makeFakeFetch([{ ok: true, status: 200 }])
      _setFetchImplementationForTesting(fakeFetch)
      initLiveServerRoute({ serverUrl: FAKE_SERVER_URL, directory: "/tmp/test", inProcessClient: fakeInProcessClient })
      _setLiveClientForTesting(fakeLiveClient)

      //#when
      const result1 = await resolveDispatchClient(fakeInProcessClient, "ses_live1")
      const result2 = await resolveDispatchClient(fakeInProcessClient, "ses_live2")

      //#then
      expect(result1.route).toBe("live")
      expect(result1.client).toBe(fakeLiveClient)
      expect(result2.route).toBe("live")
      expect(result2.client).toBe(fakeLiveClient)
      expect(callCount()).toBe(1)
    })
  })

  describe("resolveDispatchClient — 401 → unavailable + warn-once", () => {
    test("#given probe returns 401 #when resolveDispatchClient called #then returns in-process and marks unavailable", async () => {
      //#given
      const { fetch: fakeFetch } = makeFakeFetch([{ ok: false, status: 401 }])
      _setFetchImplementationForTesting(fakeFetch)
      initLiveServerRoute({ serverUrl: FAKE_SERVER_URL, directory: "/tmp/test", inProcessClient: fakeInProcessClient })

      //#when
      const result = await resolveDispatchClient(fakeInProcessClient, "ses_401")

      //#then
      expect(result.route).toBe("in-process")
    })
  })

  describe("resolveDispatchClient — 404 → unavailable", () => {
    test("#given probe returns 404 #when resolveDispatchClient called #then returns in-process", async () => {
      //#given
      const { fetch: fakeFetch } = makeFakeFetch([{ ok: false, status: 404 }])
      _setFetchImplementationForTesting(fakeFetch)
      initLiveServerRoute({ serverUrl: FAKE_SERVER_URL, directory: "/tmp/test", inProcessClient: fakeInProcessClient })

      //#when
      const result = await resolveDispatchClient(fakeInProcessClient, "ses_404")

      //#then
      expect(result.route).toBe("in-process")
    })
  })

  describe("resolveDispatchClient — timeout → in-process bounded <2s", () => {
    test("#given probe never resolves #when resolveDispatchClient called #then returns in-process within 2500ms", async () => {
      //#given
      const { fetch: neverFetch, callCount } = makeNeverResolvingFetch()
      _setFetchImplementationForTesting(neverFetch)
      initLiveServerRoute({ serverUrl: FAKE_SERVER_URL, directory: "/tmp/test", inProcessClient: fakeInProcessClient })

      //#when
      const t0 = Date.now()
      const result = await resolveDispatchClient(fakeInProcessClient, "ses_timeout")
      const elapsed = Date.now() - t0

      //#then
      expect(result.route).toBe("in-process")
      expect(elapsed).toBeLessThan(2500)
      expect(callCount()).toBe(1)
    }, 5_000)
  })

  describe("resolveDispatchClient — TTL: second resolve within 60s skips re-fetch", () => {
    test("#given two sequential resolves within TTL #when resolveDispatchClient called twice #then fetch is called only once", async () => {
      //#given
      const { fetch: fakeFetch, callCount } = makeFakeFetch([{ ok: true, status: 200 }, { ok: true, status: 200 }])
      _setFetchImplementationForTesting(fakeFetch)
      _setLiveClientForTesting(fakeLiveClient)
      initLiveServerRoute({ serverUrl: FAKE_SERVER_URL, directory: "/tmp/test", inProcessClient: fakeInProcessClient })

      //#when
      await resolveDispatchClient(fakeInProcessClient, "ses_ttl1")
      await resolveDispatchClient(fakeInProcessClient, "ses_ttl2")

      //#then
      expect(callCount()).toBe(1)
    })
  })

  describe("resolveDispatchClient — shared in-flight: concurrent resolves trigger ONE fetch", () => {
    test("#given two concurrent resolveDispatchClient calls #when both start simultaneously #then only one fetch is triggered", async () => {
      //#given
      let fetchCalls = 0
      const sharedFetch = async (_url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        fetchCalls++
        await new Promise<void>((r) => setTimeout(r, 50))
        return { ok: true, status: 200 } as Response
      }
      _setFetchImplementationForTesting(sharedFetch as unknown as typeof fetch)
      _setLiveClientForTesting(fakeLiveClient)
      initLiveServerRoute({ serverUrl: FAKE_SERVER_URL, directory: "/tmp/test", inProcessClient: fakeInProcessClient })

      //#when
      const [r1, r2] = await Promise.all([
        resolveDispatchClient(fakeInProcessClient, "ses_concurrent_a"),
        resolveDispatchClient(fakeInProcessClient, "ses_concurrent_b"),
      ])
      //#then
      expect(fetchCalls).toBe(1)
      expect(r1.route).toBe("live")
      expect(r2.route).toBe("live")
    })
  })

  describe("isPreSendConnectionFailure — truth table", () => {
    test("#given ECONNREFUSED error #when isPreSendConnectionFailure called #then returns true", () => {
      const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" })
      expect(isPreSendConnectionFailure(err)).toBe(true)
    })

    test("#given TypeError with 'fetch failed' message #when isPreSendConnectionFailure called #then returns true", () => {
      const err = new TypeError("fetch failed")
      expect(isPreSendConnectionFailure(err)).toBe(true)
    })

    test("#given TypeError with 'Unable to connect' message #when isPreSendConnectionFailure called #then returns true", () => {
      const err = new TypeError("Unable to connect to 127.0.0.1:1")
      expect(isPreSendConnectionFailure(err)).toBe(true)
    })

    test("#given ENOTFOUND error #when isPreSendConnectionFailure called #then returns true", () => {
      const err = Object.assign(new Error("getaddrinfo ENOTFOUND host"), { code: "ENOTFOUND" })
      expect(isPreSendConnectionFailure(err)).toBe(true)
    })

    test("#given EAI_AGAIN error #when isPreSendConnectionFailure called #then returns true", () => {
      const err = Object.assign(new Error("getaddrinfo EAI_AGAIN host"), { code: "EAI_AGAIN" })
      expect(isPreSendConnectionFailure(err)).toBe(true)
    })

    test("#given AbortError #when isPreSendConnectionFailure called #then returns false", () => {
      const err = Object.assign(new Error("The operation was aborted"), { name: "AbortError" })
      expect(isPreSendConnectionFailure(err)).toBe(false)
    })

    test("#given plain Error #when isPreSendConnectionFailure called #then returns false", () => {
      const err = new Error("some random error")
      expect(isPreSendConnectionFailure(err)).toBe(false)
    })

    test("#given non-Error value #when isPreSendConnectionFailure called #then returns false", () => {
      expect(isPreSendConnectionFailure("string error")).toBe(false)
      expect(isPreSendConnectionFailure(null)).toBe(false)
      expect(isPreSendConnectionFailure(42)).toBe(false)
    })

    test("#given error with cause.code ECONNREFUSED #when isPreSendConnectionFailure called #then returns true", () => {
      const cause = Object.assign(new Error("cause"), { code: "ECONNREFUSED" })
      const err = Object.assign(new TypeError("fetch failed"), { cause })
      expect(isPreSendConnectionFailure(err)).toBe(true)
    })
  })

  describe("resolveDispatchClient — serverUrl undefined → permanently in-process", () => {
    test("#given serverUrl undefined #when initLiveServerRoute called and resolveDispatchClient invoked #then always returns in-process without probing", async () => {
      //#given
      const { fetch: fakeFetch, callCount } = makeFakeFetch([{ ok: true, status: 200 }])
      _setFetchImplementationForTesting(fakeFetch)
      initLiveServerRoute({ serverUrl: undefined, directory: "/tmp/test", inProcessClient: fakeInProcessClient })

      //#when
      const result = await resolveDispatchClient(fakeInProcessClient, "ses_no_url")

      //#then
      expect(result.route).toBe("in-process")
      expect(callCount()).toBe(0)
    })
  })

  describe("resolveDispatchClient — multiple server() registrations (multi-instance serve)", () => {
    test("#given two registrations with different in-process clients #when resolveDispatchClient called with the first client #then it still routes live instead of identity passthrough", async () => {
      //#given
      const { fetch: fakeFetch } = makeFakeFetch([{ ok: true, status: 200 }, { ok: true, status: 200 }])
      _setFetchImplementationForTesting(fakeFetch)
      const firstClient = { _marker: "first" } as unknown
      const secondClient = { _marker: "second" } as unknown
      initLiveServerRoute({ serverUrl: FAKE_SERVER_URL, directory: "/tmp/instance-one", inProcessClient: firstClient })
      _setLiveClientForTesting(fakeLiveClient)
      initLiveServerRoute({ serverUrl: FAKE_SERVER_URL, directory: "/tmp/instance-two", inProcessClient: secondClient })

      //#when
      const first = await resolveDispatchClient(firstClient, "ses_instance_one")
      const second = await resolveDispatchClient(secondClient, "ses_instance_two")

      //#then
      expect(first.route).toBe("live")
      expect(second.route).toBe("live")
    })
  })

  describe("tryResolveDispatchClientSync — synchronous fast path", () => {
    test("#given an unregistered client #when tryResolveDispatchClientSync called #then it returns identity passthrough without awaiting", () => {
      //#given
      const unregistered = { _marker: "unregistered" } as unknown

      //#when
      const result = tryResolveDispatchClientSync(unregistered, "ses_sync_identity")

      //#then
      expect(result).toEqual({ client: unregistered, route: "in-process", reason: "identity" })
    })

    test("#given a registered client with no probe yet #when tryResolveDispatchClientSync called #then it returns undefined (async probe required)", () => {
      //#given
      initLiveServerRoute({ serverUrl: FAKE_SERVER_URL, directory: "/tmp/sync", inProcessClient: fakeInProcessClient })

      //#when
      const result = tryResolveDispatchClientSync(fakeInProcessClient, "ses_sync_stale")

      //#then
      expect(result).toBeUndefined()
    })

    test("#given a registered client with a fresh available probe #when tryResolveDispatchClientSync called #then it returns the live route synchronously", async () => {
      //#given
      const { fetch: fakeFetch } = makeFakeFetch([{ ok: true, status: 200 }])
      _setFetchImplementationForTesting(fakeFetch)
      initLiveServerRoute({ serverUrl: FAKE_SERVER_URL, directory: "/tmp/sync", inProcessClient: fakeInProcessClient })
      _setLiveClientForTesting(fakeLiveClient)
      await resolveDispatchClient(fakeInProcessClient, "ses_sync_warm")

      //#when
      const result = tryResolveDispatchClientSync(fakeInProcessClient, "ses_sync_fresh")

      //#then
      expect(result?.route).toBe("live")
      expect(result?.client).toBe(fakeLiveClient)
    })
  })

  describe("markLiveRouteUnavailable", () => {
    test("#given available route #when markLiveRouteUnavailable called #then subsequent resolve returns in-process", async () => {
      //#given
      const { fetch: fakeFetch } = makeFakeFetch([{ ok: true, status: 200 }])
      _setFetchImplementationForTesting(fakeFetch)
      _setLiveClientForTesting(fakeLiveClient)
      initLiveServerRoute({ serverUrl: FAKE_SERVER_URL, directory: "/tmp/test", inProcessClient: fakeInProcessClient })

      const before = await resolveDispatchClient(fakeInProcessClient, "ses_before")
      expect(before.route).toBe("live")

      //#when
      markLiveRouteUnavailable("test-reason")

      //#then — unavailable mark holds for the TTL window: no re-probe on the next resolve
      const { fetch: fakeFetch2, callCount: callCount2 } = makeFakeFetch([{ ok: true, status: 200 }])
      _setFetchImplementationForTesting(fakeFetch2)
      const after = await resolveDispatchClient(fakeInProcessClient, "ses_after")
      expect(after.route).toBe("in-process")
      expect(callCount2()).toBe(0)
    })
  })

  describe("provenance log constants exported", () => {
    test("#given module exports #when constants checked #then LIVE_ROUTE_DISPATCH_LOG and LIVE_ROUTE_UNAVAILABLE_LOG are non-empty strings", () => {
      expect(typeof LIVE_ROUTE_DISPATCH_LOG).toBe("string")
      expect(LIVE_ROUTE_DISPATCH_LOG.length).toBeGreaterThan(0)
      expect(LIVE_ROUTE_DISPATCH_LOG).toContain("[live-server-route]")

      expect(typeof LIVE_ROUTE_UNAVAILABLE_LOG).toBe("string")
      expect(LIVE_ROUTE_UNAVAILABLE_LOG.length).toBeGreaterThan(0)
      expect(LIVE_ROUTE_UNAVAILABLE_LOG).toContain("[live-server-route]")
    })
  })

  describe("warmLiveServerProbe", () => {
    test("#given initialized route #when warmLiveServerProbe called #then returns void synchronously (fire-and-forget)", () => {
      //#given
      initLiveServerRoute({ serverUrl: FAKE_SERVER_URL, directory: "/tmp/test", inProcessClient: fakeInProcessClient })

      //#when / then — must not throw, must not return a promise that callers must await
      const result = warmLiveServerProbe()
      expect(result).toBeUndefined()
    })
  })
})
