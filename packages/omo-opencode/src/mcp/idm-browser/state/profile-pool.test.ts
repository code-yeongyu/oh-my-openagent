import { describe, test, expect, afterEach } from "bun:test"
import { join } from "node:path"
import { rm, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { createProfilePool } from "./profile-pool"

describe("ProfilePool", () => {
  let testDir: string

  afterEach(async () => {
    if (testDir) await rm(testDir, { recursive: true, force: true })
  })

  describe("#given empty pool", () => {
    test("#when getStats #then all zeros", async () => {
      testDir = await mkdtemp(join(tmpdir(), "profile-pool-"))
      const pool = createProfilePool(testDir)
      const stats = pool.getStats()
      expect(stats.total).toBe(0)
    })
  })

  describe("#given acquired profile", () => {
    test("#when acquire #then returns profile with in_use status", async () => {
      testDir = await mkdtemp(join(tmpdir(), "profile-pool-"))
      const pool = createProfilePool(testDir)
      const profile = await pool.acquire()
      expect(profile.status).toBe("in_use")
      expect(profile.dir).toContain(testDir)
    })

    test("#when release #then profile becomes available", async () => {
      testDir = await mkdtemp(join(tmpdir(), "profile-pool-"))
      const pool = createProfilePool(testDir)
      const profile = await pool.acquire()
      pool.release(profile.id)
      const stats = pool.getStats()
      expect(stats.available).toBe(1)
      expect(stats.inUse).toBe(0)
    })

    test("#when burn then cleanup #then profile dir removed", async () => {
      testDir = await mkdtemp(join(tmpdir(), "profile-pool-"))
      const pool = createProfilePool(testDir)
      const profile = await pool.acquire()
      pool.burn(profile.id)
      const cleaned = await pool.cleanup()
      expect(cleaned).toBe(1)
      expect(pool.getStats().total).toBe(0)
    })
  })
})
