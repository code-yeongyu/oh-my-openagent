import { describe, expect, test } from "bun:test"
import type { PoolAccount } from "./pool-types"
import { createAccountPool } from "./account-pool"

function fakeAccount(id: string): PoolAccount {
  return {
    id,
    provider: {} as PoolAccount["provider"],
    baseUrl: "https://chat.deepseek.com",
    creds: {} as PoolAccount["creds"],
  }
}

describe("createAccountPool", () => {
  describe("#given empty accounts list", () => {
    test("#when constructed #then throws", () => {
      expect(() => createAccountPool({ accounts: [] })).toThrow(/at least one/)
    })
  })

  describe("#given three accounts #when 6 acquires fired with immediate release #then round-robin order observed", () => {
    test("round-robin order", async () => {
      const pool = createAccountPool({
        accounts: [fakeAccount("a"), fakeAccount("b"), fakeAccount("c")],
      })
      const ids: string[] = []
      for (let i = 0; i < 6; i++) {
        const r = await pool.acquire()
        ids.push(r.account.id)
        r.release()
      }
      expect(ids).toEqual(["a", "b", "c", "a", "b", "c"])
      pool.shutdown()
    })
  })

  describe("#given burst-cap is 2 (default) #when 3 simultaneous acquires on a single-account pool #then 3rd waits in FIFO queue", () => {
    test("FIFO wait queue + cap enforcement", async () => {
      const pool = createAccountPool({ accounts: [fakeAccount("solo")] })
      const r1 = await pool.acquire()
      const r2 = await pool.acquire()
      const order: string[] = []
      const p3 = pool.acquire().then((r) => {
        order.push("p3")
        return r
      })
      const p4 = pool.acquire().then((r) => {
        order.push("p4")
        return r
      })
      await new Promise((r) => setTimeout(r, 5))
      expect(order).toEqual([])
      r1.release()
      const r3 = await p3
      r2.release()
      const r4 = await p4
      expect(order).toEqual(["p3", "p4"])
      r3.release()
      r4.release()
      pool.shutdown()
    })
  })

  describe("#given an acquire enters wait queue #when timeout expires #then promise rejects and waiter is removed", () => {
    test("acquire timeout", async () => {
      const pool = createAccountPool({ accounts: [fakeAccount("solo")] })
      const r1 = await pool.acquire()
      const r2 = await pool.acquire()
      const t0 = Date.now()
      await expect(pool.acquire(50)).rejects.toThrow(/timeout/)
      const elapsed = Date.now() - t0
      expect(elapsed).toBeGreaterThanOrEqual(40)
      r1.release()
      r2.release()
      pool.shutdown()
    })
  })

  describe("#given an account is marked muted #when acquired #then mute removes it from rotation", () => {
    test("mute excludes account", async () => {
      const pool = createAccountPool({
        accounts: [fakeAccount("a"), fakeAccount("b")],
      })
      pool.markMuted("a")
      const ids: string[] = []
      for (let i = 0; i < 4; i++) {
        const r = await pool.acquire()
        ids.push(r.account.id)
        r.release()
      }
      expect(ids).toEqual(["b", "b", "b", "b"])
      pool.shutdown()
    })
  })

  describe("#given an account is in cooldown #when checked #then it's skipped until cooldown expires", () => {
    test("cooldown blocks then recovers", async () => {
      let nowVal = 1_000
      const pool = createAccountPool({
        accounts: [fakeAccount("a"), fakeAccount("b")],
        now: () => nowVal,
      })
      pool.triggerCooldown("a", 5_000)
      const r1 = await pool.acquire()
      r1.release()
      expect(r1.account.id).toBe("b")
      nowVal += 6_000
      const r2 = await pool.acquire()
      r2.release()
      expect(r2.account.id).toBe("a")
      pool.shutdown()
    })
  })

  describe("#given waiters in queue #when account is unmuted #then waiters are resolved", () => {
    test("unmute notifies waiters", async () => {
      const pool = createAccountPool({ accounts: [fakeAccount("solo")] })
      pool.markMuted("solo")
      let resolved = false
      const p = pool.acquire(1000).then((r) => {
        resolved = true
        return r
      })
      await new Promise((r) => setTimeout(r, 5))
      expect(resolved).toBe(false)
      pool.markUnmuted("solo")
      const r = await p
      expect(resolved).toBe(true)
      expect(r.account.id).toBe("solo")
      r.release()
      pool.shutdown()
    })
  })

  describe("#given pool is shut down #when acquire called #then promise rejects", () => {
    test("shutdown rejects", async () => {
      const pool = createAccountPool({ accounts: [fakeAccount("a")] })
      pool.shutdown()
      await expect(pool.acquire(1000)).rejects.toThrow(/shutting down/)
    })
  })

  describe("#given waiters in queue #when shutdown called #then all waiters reject", () => {
    test("shutdown drains waiters", async () => {
      const pool = createAccountPool({ accounts: [fakeAccount("solo")] })
      const r1 = await pool.acquire()
      const r2 = await pool.acquire()
      const p = pool.acquire(5_000)
      await new Promise((r) => setTimeout(r, 5))
      pool.shutdown()
      await expect(p).rejects.toThrow(/shutting down/)
      r1.release()
      r2.release()
    })
  })

  describe("#given a single acquire #when release() called twice (idempotency check) #then inflight decrements exactly once", () => {
    test("release is idempotent", async () => {
      const pool = createAccountPool({ accounts: [fakeAccount("solo")] })
      const r1 = await pool.acquire()
      const r2 = await pool.acquire()
      expect(pool.getState("solo")!.inflight).toBe(2)
      r1.release()
      expect(pool.getState("solo")!.inflight).toBe(1)
      r1.release()
      r1.release()
      r1.release()
      expect(pool.getState("solo")!.inflight).toBe(1)
      r2.release()
      expect(pool.getState("solo")!.inflight).toBe(0)
      pool.shutdown()
    })
  })

  describe("#given default 60-rpm sustained cap #when 10 acquires fired #then 11th hits cap on same account", () => {
    test("sustained-rpm cap enforced (single account)", async () => {
      let nowVal = 1_000
      const pool = createAccountPool({
        accounts: [fakeAccount("solo")],
        now: () => nowVal,
      })
      for (let i = 0; i < 10; i++) {
        const r = await pool.acquire()
        r.release()
        nowVal += 100
      }
      const state = pool.getState("solo")!
      expect(state.recent_request_ts.length).toBe(10)
      const t0 = Date.now()
      await expect(pool.acquire(50)).rejects.toThrow(/timeout/)
      expect(Date.now() - t0).toBeGreaterThanOrEqual(40)
      pool.shutdown()
    })
  })
})
