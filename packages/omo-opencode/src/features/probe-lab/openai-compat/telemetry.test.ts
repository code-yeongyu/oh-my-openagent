import { describe, expect, test } from "bun:test"
import {
  classifyVerdict,
  createTelemetry,
} from "./telemetry"

describe("createTelemetry", () => {
  describe("#given a fresh telemetry instance", () => {
    test("#when no events recorded #then snapshot is empty", () => {
      const t = createTelemetry()
      const s = t.snapshot()
      expect(s.total_events).toBe(0)
      expect(s.per_account).toEqual([])
    })
  })

  describe("#given several events for the same account", () => {
    test("#when recorded #then counters increment correctly per class", () => {
      const t = createTelemetry()
      t.record({ account_id: "a1", error_type: "success", ts: 1, request_id: "r1" })
      t.record({ account_id: "a1", error_type: "success", ts: 2, request_id: "r2" })
      t.record({ account_id: "a1", error_type: "http_429", ts: 3, request_id: "r3" })
      const s = t.snapshot()
      expect(s.total_events).toBe(3)
      expect(s.per_account).toHaveLength(1)
      const a = s.per_account[0]!
      expect(a.account_id).toBe("a1")
      expect(a.counters.success).toBe(2)
      expect(a.counters.http_429).toBe(1)
      expect(a.counters.empty_sse).toBe(0)
    })
  })

  describe("#given events for two accounts", () => {
    test("#when snapshot taken #then both accounts present with isolated counters", () => {
      const t = createTelemetry()
      t.record({ account_id: "a", error_type: "success", ts: 1, request_id: "r1" })
      t.record({ account_id: "b", error_type: "empty_sse", ts: 2, request_id: "r2" })
      const s = t.snapshot()
      expect(s.per_account).toHaveLength(2)
      const aSnap = s.per_account.find((p) => p.account_id === "a")!
      const bSnap = s.per_account.find((p) => p.account_id === "b")!
      expect(aSnap.counters.success).toBe(1)
      expect(bSnap.counters.empty_sse).toBe(1)
      expect(aSnap.counters.empty_sse).toBe(0)
      expect(bSnap.counters.success).toBe(0)
    })
  })

  describe("#given recent ring buffer", () => {
    test("#when fewer than 1000 events recorded #then recent contains all in order", () => {
      const t = createTelemetry()
      for (let i = 0; i < 5; i++) {
        t.record({
          account_id: "x",
          error_type: "success",
          ts: i,
          request_id: `r${i}`,
        })
      }
      const a = t.snapshot().per_account[0]!
      expect(a.recent).toHaveLength(5)
      expect(a.recent[0]!.request_id).toBe("r0")
      expect(a.recent[4]!.request_id).toBe("r4")
    })
  })
})

describe("classifyVerdict", () => {
  describe("#given ok=true", () => {
    test("#when classified #then returns success", () => {
      expect(classifyVerdict({ ok: true })).toBe("success")
    })
  })

  describe("#given empty_sse error type", () => {
    test("#when classified #then returns empty_sse", () => {
      expect(
        classifyVerdict({ ok: false, errorType: "empty_sse", status: 502 }),
      ).toBe("empty_sse")
    })
  })

  describe("#given truncated_stream error type", () => {
    test("#when classified #then returns truncated_stream", () => {
      expect(
        classifyVerdict({
          ok: false,
          errorType: "truncated_stream",
          status: 502,
        }),
      ).toBe("truncated_stream")
    })
  })

  describe("#given message contains MISSING_HEADER", () => {
    test("#when classified #then returns missing_header", () => {
      expect(
        classifyVerdict({
          ok: false,
          errorType: "internal_error",
          status: 502,
          message: "DeepSeek MISSING_HEADER (biz_code 40300)",
        }),
      ).toBe("missing_header")
    })
  })

  describe("#given status 429", () => {
    test("#when classified #then returns http_429", () => {
      expect(
        classifyVerdict({
          ok: false,
          errorType: "rate_limit_error",
          status: 429,
        }),
      ).toBe("http_429")
    })
  })

  describe("#given a generic 4xx", () => {
    test("#when classified #then returns http_4xx", () => {
      expect(
        classifyVerdict({
          ok: false,
          errorType: "internal_error",
          status: 403,
        }),
      ).toBe("http_4xx")
    })
  })

  describe("#given a message containing 'timeout'", () => {
    test("#when classified #then returns timeout (before http_4xx fallback)", () => {
      expect(
        classifyVerdict({
          ok: false,
          errorType: "internal_error",
          message: "dispatch timeout after 120000ms",
        }),
      ).toBe("timeout")
    })
  })

  describe("#given a message containing ETIMEDOUT", () => {
    test("#when classified #then returns timeout", () => {
      expect(
        classifyVerdict({
          ok: false,
          errorType: "internal_error",
          message: "fetch failed: ETIMEDOUT",
        }),
      ).toBe("timeout")
    })
  })

  describe("#given a message containing ECONNRESET", () => {
    test("#when classified #then returns connection_reset", () => {
      expect(
        classifyVerdict({
          ok: false,
          errorType: "internal_error",
          message: "fetch failed: ECONNRESET",
        }),
      ).toBe("connection_reset")
    })
  })

  describe("#given a message containing 'stream errored'", () => {
    test("#when classified #then returns connection_reset", () => {
      expect(
        classifyVerdict({
          ok: false,
          errorType: "internal_error",
          message: "stream errored: upstream closed",
        }),
      ).toBe("connection_reset")
    })
  })

  describe("#given a message containing 'socket hang up'", () => {
    test("#when classified #then returns connection_reset", () => {
      expect(
        classifyVerdict({
          ok: false,
          errorType: "internal_error",
          message: "fetch error: socket hang up",
        }),
      ).toBe("connection_reset")
    })
  })

  describe("#given timeout dominates over status 429", () => {
    test("#when both signals present #then timeout wins", () => {
      expect(
        classifyVerdict({
          ok: false,
          errorType: "internal_error",
          status: 429,
          message: "request timeout",
        }),
      ).toBe("timeout")
    })
  })

  describe("#given counters include the new classes", () => {
    test("#when timeout/connection_reset recorded #then counters increment", () => {
      const t = createTelemetry()
      t.record({ account_id: "a", error_type: "timeout", ts: 1, request_id: "r1" })
      t.record({
        account_id: "a",
        error_type: "connection_reset",
        ts: 2,
        request_id: "r2",
      })
      const s = t.snapshot().per_account[0]!
      expect(s.counters.timeout).toBe(1)
      expect(s.counters.connection_reset).toBe(1)
    })
  })
})
