import { describe, expect, test } from "bun:test"
import type { ProviderCredentials } from "../providers/provider-types"
import { buildAccountPool, resetPoolCacheForTests } from "./pool-factory"
import type { LoadedProvider, ProviderStoreLike } from "./provider-factory"

function fakeLoaded(id: string): LoadedProvider {
  const creds: ProviderCredentials = {
    id,
    name: id,
    provider_type: "deepseek_web",
    base_url: "https://chat.deepseek.com",
    auth_type: "cookie_session",
    auth_config: "{}",
    default_headers: null,
    rate_limit_rps: null,
    rate_limit_rpm: null,
    rate_limit_tpm: null,
    cooldown_on_429_s: 0,
    supported_models: null,
    health_check_url: null,
    health_check_interval_s: 0,
    status: "active",
    created_at: 0,
    updated_at: 0,
  }
  return {
    provider: { id, kind: "deepseek_web" } as LoadedProvider["provider"],
    baseUrl: "https://chat.deepseek.com",
    creds,
  }
}

void ({} as ProviderStoreLike)

describe("buildAccountPool", () => {
  describe("#given two LoadedProvider entries #when built #then pool has 2 accounts in order", () => {
    test("build", () => {
      resetPoolCacheForTests()
      const pool = buildAccountPool([fakeLoaded("p1"), fakeLoaded("p2")])
      expect(pool.size()).toBe(2)
      expect(pool.list().map((a) => a.id)).toEqual(["p1", "p2"])
      pool.shutdown()
    })
  })

  describe("#given one LoadedProvider (singular env path) #when built #then pool of 1 with BURST_INFLIGHT_CAP=2 still enforces", () => {
    test("pool-of-1 burst cap", async () => {
      resetPoolCacheForTests()
      const pool = buildAccountPool([fakeLoaded("solo")])
      expect(pool.size()).toBe(1)
      const r1 = await pool.acquire()
      const r2 = await pool.acquire()
      expect(r1.account.id).toBe("solo")
      expect(r2.account.id).toBe("solo")
      const t0 = Date.now()
      await expect(pool.acquire(40)).rejects.toThrow(/timeout/)
      expect(Date.now() - t0).toBeGreaterThanOrEqual(30)
      r1.release()
      r2.release()
      pool.shutdown()
    })
  })
})
