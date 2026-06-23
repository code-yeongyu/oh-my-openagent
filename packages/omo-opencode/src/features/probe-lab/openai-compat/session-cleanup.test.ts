import { describe, expect, test } from "bun:test"
import type {
  ProbeProvider,
  ProbeRequest,
  ProbeResponse,
} from "../providers/provider-types"
import {
  drainSessionDeletes,
  enqueueSessionDelete,
  getInflightSessionDeleteCountForTests,
  resetSessionDeleteInflightForTests,
  type SessionDeleteResult,
} from "./session-cleanup"

function deleteOkProvider(captured: ProbeRequest[]): ProbeProvider {
  return {
    id: "p",
    kind: "deepseek_web",
    healthCheck: async () => ({ ok: true, message: "", checked_at: 0 }),
    refreshCredentials: async () => ({ success: true, refresh_type: "" }),
    rotateCredentials: async () => ({ success: false, rotation_type: "" }),
    dispatchProbe: async (req: ProbeRequest): Promise<ProbeResponse> => {
      captured.push(req)
      return {
        status: 200,
        headers: {},
        body: '{"code":0,"data":{}}',
        timing: { total_ms: 5 },
        identity_used: null,
        fingerprint_used: null,
        retry_count: 0,
      }
    },
    getRateLimits: () => ({ rps: null, rpm: null, tpm: null, cooldown_on_429_s: 0 }),
    getErrorTaxonomy: () => ({ rate_limited_signals: [], blocked_signals: [] }),
    getSupportedModels: () => [],
  }
}

function delete5xxProvider(captured: ProbeRequest[]): ProbeProvider {
  return {
    ...deleteOkProvider(captured),
    dispatchProbe: async (req): Promise<ProbeResponse> => {
      captured.push(req)
      return {
        status: 502,
        headers: {},
        body: "down",
        timing: { total_ms: 5 },
        identity_used: null,
        fingerprint_used: null,
        retry_count: 0,
      }
    },
  }
}

function deleteThrowsProvider(captured: ProbeRequest[]): ProbeProvider {
  return {
    ...deleteOkProvider(captured),
    dispatchProbe: async (req): Promise<ProbeResponse> => {
      captured.push(req)
      throw new Error("network-down")
    },
  }
}

function syncSched(fn: () => void): void {
  fn()
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe("enqueueSessionDelete", () => {
  describe("#given upstream returns 200 #when invoked #then onComplete reports ok=true and POST went to /chat_session/delete", () => {
    test("happy path", async () => {
      const captured: ProbeRequest[] = []
      const provider = deleteOkProvider(captured)
      const events: SessionDeleteResult[] = []
      enqueueSessionDelete({
        provider,
        baseUrl: "https://chat.deepseek.com",
        chatSessionId: "sess-abc",
        requestId: "rid-1",
        onComplete: (r) => events.push(r),
        scheduler: syncSched,
      })
      await flushMicrotasks()
      expect(captured).toHaveLength(1)
      expect(captured[0]!.url).toBe(
        "https://chat.deepseek.com/api/v0/chat_session/delete",
      )
      expect(captured[0]!.method).toBe("POST")
      expect(captured[0]!.body).toBe('{"chat_session_id":"sess-abc"}')
      expect(events).toHaveLength(1)
      expect(events[0]!.ok).toBe(true)
      expect(events[0]!.status).toBe(200)
    })
  })

  describe("#given upstream returns 5xx #when invoked #then onComplete reports ok=false with status, no throw to caller", () => {
    test("5xx path", async () => {
      const captured: ProbeRequest[] = []
      const provider = delete5xxProvider(captured)
      const events: SessionDeleteResult[] = []
      enqueueSessionDelete({
        provider,
        baseUrl: "https://chat.deepseek.com",
        chatSessionId: "sess-x",
        requestId: "rid-2",
        onComplete: (r) => events.push(r),
        scheduler: syncSched,
      })
      await flushMicrotasks()
      expect(events[0]!.ok).toBe(false)
      expect(events[0]!.status).toBe(502)
    })
  })

  describe("#given dispatch throws #when invoked #then onComplete reports ok=false with reason, caller continues", () => {
    test("throw path", async () => {
      const captured: ProbeRequest[] = []
      const provider = deleteThrowsProvider(captured)
      const events: SessionDeleteResult[] = []
      enqueueSessionDelete({
        provider,
        baseUrl: "https://chat.deepseek.com",
        chatSessionId: "sess-y",
        requestId: "rid-3",
        onComplete: (r) => events.push(r),
        scheduler: syncSched,
      })
      await flushMicrotasks()
      expect(events[0]!.ok).toBe(false)
      expect(events[0]!.reason).toContain("network-down")
    })
  })

  describe("#given default scheduler (queueMicrotask) #when invoked #then call returns synchronously, request fires later", () => {
    test("microtask path", async () => {
      const captured: ProbeRequest[] = []
      const provider = deleteOkProvider(captured)
      enqueueSessionDelete({
        provider,
        baseUrl: "https://chat.deepseek.com",
        chatSessionId: "sess-z",
        requestId: "rid-4",
      })
      expect(captured).toHaveLength(0)
      await flushMicrotasks()
      expect(captured).toHaveLength(1)
    })
  })

  describe("#given two enqueued deletes #when drain awaits all #then both complete and inflight is empty", () => {
    test("drain happy path", async () => {
      resetSessionDeleteInflightForTests()
      const captured: ProbeRequest[] = []
      const provider = deleteOkProvider(captured)
      enqueueSessionDelete({
        provider,
        baseUrl: "https://chat.deepseek.com",
        chatSessionId: "s1",
        requestId: "rid-d1",
      })
      enqueueSessionDelete({
        provider,
        baseUrl: "https://chat.deepseek.com",
        chatSessionId: "s2",
        requestId: "rid-d2",
      })
      expect(getInflightSessionDeleteCountForTests()).toBe(2)
      const r = await drainSessionDeletes(2_000)
      expect(r.pending_at_drain).toBe(2)
      expect(r.drained).toBe(2)
      expect(r.timed_out).toBe(false)
      expect(getInflightSessionDeleteCountForTests()).toBe(0)
      expect(captured).toHaveLength(2)
    })
  })

  describe("#given a slow delete #when drain timeout expires first #then drain returns timed_out=true", () => {
    test("drain timeout path", async () => {
      resetSessionDeleteInflightForTests()
      const slowProvider: ProbeProvider = {
        id: "slow",
        kind: "deepseek_web",
        healthCheck: async () => ({ ok: true, message: "", checked_at: 0 }),
        refreshCredentials: async () => ({ success: true, refresh_type: "" }),
        rotateCredentials: async () => ({ success: false, rotation_type: "" }),
        dispatchProbe: (_req): Promise<ProbeResponse> =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  status: 200,
                  headers: {},
                  body: "",
                  timing: { total_ms: 0 },
                  identity_used: null,
                  fingerprint_used: null,
                  retry_count: 0,
                }),
              5_000,
            ),
          ),
        getRateLimits: () => ({
          rps: null,
          rpm: null,
          tpm: null,
          cooldown_on_429_s: 0,
        }),
        getErrorTaxonomy: () => ({
          rate_limited_signals: [],
          blocked_signals: [],
        }),
        getSupportedModels: () => [],
      }
      enqueueSessionDelete({
        provider: slowProvider,
        baseUrl: "https://chat.deepseek.com",
        chatSessionId: "s-slow",
        requestId: "rid-slow",
      })
      const t0 = Date.now()
      const r = await drainSessionDeletes(50)
      expect(Date.now() - t0).toBeLessThan(2_000)
      expect(r.pending_at_drain).toBe(1)
      expect(r.timed_out).toBe(true)
      resetSessionDeleteInflightForTests()
    })
  })

  describe("#given no in-flight deletes #when drain called #then returns immediately with zeros", () => {
    test("drain empty", async () => {
      resetSessionDeleteInflightForTests()
      const r = await drainSessionDeletes(1_000)
      expect(r.drained).toBe(0)
      expect(r.pending_at_drain).toBe(0)
      expect(r.timed_out).toBe(false)
    })
  })

  describe("#given trailing slash on baseUrl #when invoked #then path normalises to a single slash", () => {
    test("trailing slash", async () => {
      const captured: ProbeRequest[] = []
      const provider = deleteOkProvider(captured)
      enqueueSessionDelete({
        provider,
        baseUrl: "https://chat.deepseek.com/",
        chatSessionId: "s",
        requestId: "rid-5",
        scheduler: syncSched,
      })
      await flushMicrotasks()
      expect(captured[0]!.url).toBe(
        "https://chat.deepseek.com/api/v0/chat_session/delete",
      )
    })
  })
})
