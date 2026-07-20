/**
 * Unit tests for test runner
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readdirSync, rmdirSync } from "fs"
import { join } from "path"
import {
  TestMode,
  TEST_MODE_CONFIG,
  CACHE_CONFIG,
  API_TIMEOUT_CONFIG,
  generateCacheKey,
  ensureCacheDirectory,
  getCacheEntry,
  saveCacheEntry,
  isCacheEntryValid,
  getCacheSize,
  cleanCache,
  loadTestProgress,
  saveTestProgress,
  createTestProgress,
  shouldSkipTest,
  markTestCompleted,
  sleep,
  retryWithBackoff,
  executeWithTimeout,
  isRateLimitError,
  extractRetryAfter,
} from "./test-runner"

describe("test-runner", () => {
  const testCacheDir = ".cache/test-compaction"
  const testProgressFile = ".cache/test-progress.json"

  beforeEach(() => {
    // Create test directories
    if (!existsSync(testCacheDir)) {
      mkdirSync(testCacheDir, { recursive: true })
    }
  })

  afterEach(() => {
    // Clean up test files
    if (existsSync(testCacheDir)) {
      const files = readdirSync(testCacheDir)
      for (const file of files) {
        unlinkSync(join(testCacheDir, file))
      }
      rmdirSync(testCacheDir)
    }
    if (existsSync(testProgressFile)) {
      unlinkSync(testProgressFile)
    }
  })

  describe("TestMode", () => {
    it("should have correct test modes", () => {
      expect(TestMode.QUICK).toBe("quick")
      expect(TestMode.STANDARD).toBe("standard")
      expect(TestMode.FULL).toBe("full")
      expect(TestMode.STRESS).toBe("stress")
    })
  })

  describe("TEST_MODE_CONFIG", () => {
    it("should have configuration for all modes", () => {
      expect(TEST_MODE_CONFIG[TestMode.QUICK]).toBeDefined()
      expect(TEST_MODE_CONFIG[TestMode.STANDARD]).toBeDefined()
      expect(TEST_MODE_CONFIG[TestMode.FULL]).toBeDefined()
      expect(TEST_MODE_CONFIG[TestMode.STRESS]).toBeDefined()
    })

    it("should have correct quick mode config", () => {
      const config = TEST_MODE_CONFIG[TestMode.QUICK]
      expect(config.models).toBe(1)
      expect(config.facts).toBe(8)
      expect(config.timeout).toBe(120000)
    })

    it("should have correct standard mode config", () => {
      const config = TEST_MODE_CONFIG[TestMode.STANDARD]
      expect(config.models).toBe(3)
      expect(config.facts).toBe(8)
      expect(config.timeout).toBe(300000)
    })
  })

  describe("generateCacheKey", () => {
    it("should generate consistent hash", () => {
      const key1 = generateCacheKey("test", "model", "1.0")
      const key2 = generateCacheKey("test", "model", "1.0")
      expect(key1).toBe(key2)
    })

    it("should generate different hashes for different inputs", () => {
      const key1 = generateCacheKey("test1", "model", "1.0")
      const key2 = generateCacheKey("test2", "model", "1.0")
      expect(key1).not.toBe(key2)
    })
  })

  describe("cache operations", () => {
    it("should save and retrieve cache entry", () => {
      const cacheKey = "test-key"
      const entry = {
        summary: "test summary",
        timestamp: Date.now(),
        model: "test-model",
        inputTokens: 100,
        outputTokens: 50,
        promptVersion: "1.0",
      }

      saveCacheEntry(cacheKey, entry)
      const retrieved = getCacheEntry(cacheKey)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.summary).toBe("test summary")
    })

    it("should return null for non-existent cache entry", () => {
      const retrieved = getCacheEntry("non-existent-key")
      expect(retrieved).toBeNull()
    })

    it("should validate cache entry age", () => {
      const recentEntry = {
        summary: "test",
        timestamp: Date.now(),
        model: "test",
        inputTokens: 100,
        outputTokens: 50,
        promptVersion: "1.0",
      }
      expect(isCacheEntryValid(recentEntry)).toBe(true)

      const oldEntry = {
        ...recentEntry,
        timestamp: Date.now() - 31 * 24 * 60 * 60 * 1000, // 31 days ago
      }
      expect(isCacheEntryValid(oldEntry)).toBe(false)
    })
  })

  describe("test progress", () => {
    it("should create initial progress", () => {
      const progress = createTestProgress(TestMode.QUICK)
      expect(progress.completedModels).toHaveLength(0)
      expect(progress.testMode).toBe(TestMode.QUICK)
    })

    it("should save and load progress", () => {
      const progress = createTestProgress(TestMode.STANDARD)
      progress.completedModels.push("model-1")
      saveTestProgress(progress)

      const loaded = loadTestProgress()
      expect(loaded).not.toBeNull()
      expect(loaded?.completedModels).toContain("model-1")
    })

    it("should check if test should be skipped", () => {
      const progress = createTestProgress(TestMode.QUICK)
      progress.completedModels.push("model-1")
      progress.completedFacts["model-2"] = ["fact-1"]

      expect(shouldSkipTest(progress, "model-1", "fact-1")).toBe(true)
      expect(shouldSkipTest(progress, "model-2", "fact-1")).toBe(true)
      expect(shouldSkipTest(progress, "model-3", "fact-1")).toBe(false)
    })

    it("should mark test as completed", () => {
      const progress = createTestProgress(TestMode.QUICK)
      markTestCompleted(progress, "model-1", "fact-1")

      expect(progress.completedFacts["model-1"]).toContain("fact-1")
    })
  })

  describe("sleep", () => {
    it("should sleep for specified duration", async () => {
      const start = Date.now()
      await sleep(100)
      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(90)
      expect(elapsed).toBeLessThan(200)
    })
  })

  describe("retryWithBackoff", () => {
    it("should succeed on first attempt", async () => {
      let attempts = 0
      const result = await retryWithBackoff(async () => {
        attempts++
        return "success"
      })
      expect(result).toBe("success")
      expect(attempts).toBe(1)
    })

    it("should retry on failure", async () => {
      let attempts = 0
      const result = await retryWithBackoff(
        async () => {
          attempts++
          if (attempts < 2) {
            throw new Error("fail")
          }
          return "success"
        },
        3,
        10
      )
      expect(result).toBe("success")
      expect(attempts).toBe(2)
    })

    it("should throw after max retries", async () => {
      let attempts = 0
      await expect(
        retryWithBackoff(
          async () => {
            attempts++
            throw new Error("fail")
          },
          2,
          10
        )
      ).rejects.toThrow("fail")
      expect(attempts).toBe(2)
    })
  })

  describe("executeWithTimeout", () => {
    it("should complete before timeout", async () => {
      const result = await executeWithTimeout(async () => {
        await sleep(50)
        return "success"
      }, 1000)
      expect(result).toBe("success")
    })

    it("should timeout if operation takes too long", async () => {
      await expect(
        executeWithTimeout(
          async () => {
            await sleep(200)
            return "success"
          },
          50,
          "Test timeout"
        )
      ).rejects.toThrow("Test timeout")
    })
  })

  describe("rate limit handling", () => {
    it("should detect rate limit error", () => {
      const error429 = { status: 429, message: "rate limit exceeded" }
      expect(isRateLimitError(error429)).toBe(true)

      const errorNormal = { status: 500, message: "internal error" }
      expect(isRateLimitError(errorNormal)).toBe(false)
    })

    it("should extract retry-after header", () => {
      const errorWithHeader = {
        headers: { "retry-after": "5" },
      }
      expect(extractRetryAfter(errorWithHeader)).toBe(5000)

      const errorWithoutHeader = {}
      expect(extractRetryAfter(errorWithoutHeader)).toBe(1000)
    })
  })
})
