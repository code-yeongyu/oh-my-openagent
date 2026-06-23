import { describe, expect, test } from "bun:test"
import type { PoolAccount, PoolAccountState } from "./pool-types"
import {
  canAcquire,
  countRecentInWindow,
  DEFAULT_POLICY,
  pruneTimestamps,
} from "./rate-limit-policy"

function makeAccount(id = "a"): PoolAccount {
  return {
    id,
    provider: {} as PoolAccount["provider"],
    baseUrl: "",
    creds: {} as PoolAccount["creds"],
  }
}

function freshState(): PoolAccountState {
  return {
    inflight: 0,
    last_used_at: 0,
    cooldown_until: 0,
    is_muted: false,
    recent_request_ts: [],
  }
}

describe("canAcquire", () => {
  describe("#given a fresh account #when checked #then allows", () => {
    test("fresh allow", () => {
      expect(canAcquire(makeAccount(), freshState(), 1000)).toEqual({ ok: true })
    })
  })

  describe("#given account is muted #when checked #then rejects with mute reason", () => {
    test("muted reject", () => {
      const s = { ...freshState(), is_muted: true }
      const r = canAcquire(makeAccount("mid"), s, 1000)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(/muted/)
    })
  })

  describe("#given account is in cooldown #when checked #then rejects with cooldown reason", () => {
    test("cooldown reject", () => {
      const s = { ...freshState(), cooldown_until: 5000 }
      const r = canAcquire(makeAccount("c1"), s, 1000)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(/cooling down/)
    })
  })

  describe("#given inflight >= burst cap #when checked #then rejects", () => {
    test("burst cap reject", () => {
      const s = { ...freshState(), inflight: DEFAULT_POLICY.burstInflightCapPerAccount }
      const r = canAcquire(makeAccount(), s, 1000)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(/burst cap/)
    })
  })

  describe("#given recent rpm at sustained cap #when checked #then rejects", () => {
    test("sustained-rpm cap reject", () => {
      const now = 60_000
      const recent = Array.from(
        { length: DEFAULT_POLICY.sustainedRpmPerAccount },
        (_, i) => now - i * 1000,
      ).reverse()
      const s = { ...freshState(), recent_request_ts: recent }
      const r = canAcquire(makeAccount(), s, now)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(/sustained-rpm cap/)
    })
  })

  describe("#given timestamps older than the 60s window #when checked #then allows", () => {
    test("expired timestamps don't count", () => {
      const now = 120_000
      const recent = Array.from(
        { length: DEFAULT_POLICY.sustainedRpmPerAccount },
        (_, i) => i * 100,
      )
      const s = { ...freshState(), recent_request_ts: recent }
      expect(canAcquire(makeAccount(), s, now)).toEqual({ ok: true })
    })
  })
})

describe("countRecentInWindow", () => {
  describe("#given mixed-age timestamps (threshold = now-60_000)", () => {
    test("counts only those at or after threshold", () => {
      const now = 100_000
      const ts = [10_000, 20_000, 39_000, 41_000, 90_000, 99_000]
      expect(countRecentInWindow(ts, now)).toBe(3)
    })
  })
})

describe("pruneTimestamps", () => {
  describe("#given old timestamps #when pruned #then only fresh ones remain", () => {
    test("prune drops old", () => {
      const now = 100_000
      const ts = [10_000, 20_000, 50_000, 90_000]
      expect(pruneTimestamps(ts, now)).toEqual([50_000, 90_000])
    })
  })
  describe("#given all fresh #when pruned #then unchanged reference returned", () => {
    test("prune no-op", () => {
      const now = 100_000
      const ts = [50_000, 60_000, 90_000]
      const out = pruneTimestamps(ts, now)
      expect(out).toBe(ts)
    })
  })
})
