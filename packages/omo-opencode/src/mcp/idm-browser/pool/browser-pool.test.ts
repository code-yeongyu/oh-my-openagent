import { describe, test, expect } from "bun:test"
import { createBrowserPool } from "./browser-pool"

describe("createBrowserPool", () => {
  test("#given default config #when created #then starts with zero sessions", () => {
    const pool = createBrowserPool()
    expect(pool.getSessionCount()).toBe(0)
  })

  test("#given unknown session id #when hasSession called #then returns false", () => {
    const pool = createBrowserPool()
    expect(pool.hasSession("nonexistent")).toBe(false)
  })

  test("#given pool with maxConcurrent=1 #when shutdown called on empty pool #then does not throw", async () => {
    const pool = createBrowserPool({ maxConcurrent: 1 })
    await expect(pool.shutdown()).resolves.toBeUndefined()
  })

  test("#given empty pool #when listSessions called #then returns empty array", async () => {
    const pool = createBrowserPool()
    const sessions = await pool.listSessions()
    expect(sessions).toEqual([])
  })

  test("#given engineMaxAgeMs config #when pool created #then accepts the option without throwing", () => {
    const pool = createBrowserPool({ engineMaxAgeMs: 60_000 })
    expect(pool.getSessionCount()).toBe(0)
  })

  test("#given engineOptionsFactory and now injection #when pool created #then accepts both options", () => {
    let factoryCalls = 0
    const pool = createBrowserPool({
      engineMaxAgeMs: 1_000,
      engineOptionsFactory: async () => {
        factoryCalls += 1
        return { engine: "camoufox" as const }
      },
      now: () => 1_000_000,
    })
    expect(pool.getSessionCount()).toBe(0)
    expect(factoryCalls).toBe(0)
  })

  test("#given engineMaxAgeMs=Infinity #when pool created #then accepts and never rotates", () => {
    const pool = createBrowserPool({ engineMaxAgeMs: Number.POSITIVE_INFINITY })
    expect(pool.getSessionCount()).toBe(0)
  })
})
