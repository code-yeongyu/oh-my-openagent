import { describe, test, expect, afterEach } from "bun:test"
import { join } from "node:path"
import { unlinkSync } from "node:fs"
import { createActionCache } from "./action-cache"

const TEST_DB = join(import.meta.dir, ".test-action-cache.sqlite")

describe("ActionCache", () => {
  let cache: ReturnType<typeof createActionCache>

  afterEach(() => {
    cache?.close()
    try { unlinkSync(TEST_DB) } catch { /* may not exist */ }
    try { unlinkSync(TEST_DB + "-wal") } catch { /* may not exist */ }
    try { unlinkSync(TEST_DB + "-shm") } catch { /* may not exist */ }
  })

  describe("#given empty cache", () => {
    test("#when lookup #then returns null", () => {
      cache = createActionCache(TEST_DB)
      expect(cache.lookup("click submit", "example.com/*")).toBeNull()
    })

    test("#when size checked #then returns 0", () => {
      cache = createActionCache(TEST_DB)
      expect(cache.size()).toBe(0)
    })
  })

  describe("#given stored entry", () => {
    test("#when lookup matching #then returns cached action", () => {
      cache = createActionCache(TEST_DB)
      cache.store("click submit", "example.com/*", "button[type=submit]")
      const result = cache.lookup("click submit", "example.com/*")
      expect(result).not.toBeNull()
      expect(result!.selector).toBe("button[type=submit]")
    })

    test("#when lookup increments hit_count #then count increases", () => {
      cache = createActionCache(TEST_DB)
      cache.store("click submit", "example.com/*", "button[type=submit]")
      cache.lookup("click submit", "example.com/*")
      cache.lookup("click submit", "example.com/*")
      const result = cache.lookup("click submit", "example.com/*")
      expect(result!.hit_count).toBeGreaterThanOrEqual(2)
    })

    test("#when clear called #then size returns 0", () => {
      cache = createActionCache(TEST_DB)
      cache.store("click submit", "example.com/*", "button[type=submit]")
      expect(cache.size()).toBe(1)
      cache.clear()
      expect(cache.size()).toBe(0)
    })
  })
})
