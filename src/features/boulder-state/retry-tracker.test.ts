import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import {
  incrementRetry,
  isMaxRetries,
  getRetryCount,
  resetRetry,
  resetAllRetries,
  getBlockedTasks,
  getRetryInfo,
} from "./retry-tracker"

const TEST_DIR = join(process.cwd(), ".test-retry-tracker")
const SISYPHUS_DIR = join(TEST_DIR, ".sisyphus")

describe("retry-tracker", () => {
  beforeEach(() => {
    // Clean up and create test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
    mkdirSync(SISYPHUS_DIR, { recursive: true })
  })

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
  })

  describe("incrementRetry", () => {
    test("increments count from 0 to 1 on first call", () => {
      //#given - no previous retries
      //#when - increment retry
      const count = incrementRetry(TEST_DIR, "task-1")
      //#then - count is 1
      expect(count).toBe(1)
    })

    test("increments count on subsequent calls", () => {
      //#given - task with existing retries
      incrementRetry(TEST_DIR, "task-1")
      incrementRetry(TEST_DIR, "task-1")
      //#when - increment again
      const count = incrementRetry(TEST_DIR, "task-1")
      //#then - count is 3
      expect(count).toBe(3)
    })

    test("stores reason when provided", () => {
      //#given - increment with reason
      incrementRetry(TEST_DIR, "task-1", "Bun segfault")
      //#when - get retry info
      const info = getRetryInfo(TEST_DIR, "task-1")
      //#then - reason is stored
      expect(info?.reason).toBe("Bun segfault")
    })

    test("tracks separate counts for different tasks", () => {
      //#given - multiple tasks
      incrementRetry(TEST_DIR, "task-1")
      incrementRetry(TEST_DIR, "task-1")
      incrementRetry(TEST_DIR, "task-2")
      //#when - get counts
      const count1 = getRetryCount(TEST_DIR, "task-1")
      const count2 = getRetryCount(TEST_DIR, "task-2")
      //#then - counts are independent
      expect(count1).toBe(2)
      expect(count2).toBe(1)
    })
  })

  describe("isMaxRetries", () => {
    test("returns false when count is below max", () => {
      //#given - 2 retries
      incrementRetry(TEST_DIR, "task-1")
      incrementRetry(TEST_DIR, "task-1")
      //#when - check max (default 3)
      const result = isMaxRetries(TEST_DIR, "task-1")
      //#then - not at max
      expect(result).toBe(false)
    })

    test("returns true when count reaches max", () => {
      //#given - 3 retries
      incrementRetry(TEST_DIR, "task-1")
      incrementRetry(TEST_DIR, "task-1")
      incrementRetry(TEST_DIR, "task-1")
      //#when - check max (default 3)
      const result = isMaxRetries(TEST_DIR, "task-1")
      //#then - at max
      expect(result).toBe(true)
    })

    test("returns true when count exceeds max", () => {
      //#given - 5 retries
      for (let i = 0; i < 5; i++) {
        incrementRetry(TEST_DIR, "task-1")
      }
      //#when - check max (default 3)
      const result = isMaxRetries(TEST_DIR, "task-1")
      //#then - over max
      expect(result).toBe(true)
    })

    test("uses custom max when provided", () => {
      //#given - 2 retries
      incrementRetry(TEST_DIR, "task-1")
      incrementRetry(TEST_DIR, "task-1")
      //#when - check with custom max of 2
      const result = isMaxRetries(TEST_DIR, "task-1", 2)
      //#then - at custom max
      expect(result).toBe(true)
    })

    test("returns false for non-existent task", () => {
      //#given - no retries for task
      //#when - check max
      const result = isMaxRetries(TEST_DIR, "non-existent")
      //#then - not at max
      expect(result).toBe(false)
    })
  })

  describe("getRetryCount", () => {
    test("returns 0 for non-existent task", () => {
      //#given - no retries
      //#when - get count
      const count = getRetryCount(TEST_DIR, "non-existent")
      //#then - returns 0
      expect(count).toBe(0)
    })

    test("returns correct count for existing task", () => {
      //#given - 3 retries
      incrementRetry(TEST_DIR, "task-1")
      incrementRetry(TEST_DIR, "task-1")
      incrementRetry(TEST_DIR, "task-1")
      //#when - get count
      const count = getRetryCount(TEST_DIR, "task-1")
      //#then - returns 3
      expect(count).toBe(3)
    })
  })

  describe("resetRetry", () => {
    test("resets count to 0", () => {
      //#given - task with retries
      incrementRetry(TEST_DIR, "task-1")
      incrementRetry(TEST_DIR, "task-1")
      //#when - reset
      resetRetry(TEST_DIR, "task-1")
      //#then - count is 0
      expect(getRetryCount(TEST_DIR, "task-1")).toBe(0)
    })

    test("does not affect other tasks", () => {
      //#given - multiple tasks
      incrementRetry(TEST_DIR, "task-1")
      incrementRetry(TEST_DIR, "task-2")
      //#when - reset task-1
      resetRetry(TEST_DIR, "task-1")
      //#then - task-2 is unaffected
      expect(getRetryCount(TEST_DIR, "task-1")).toBe(0)
      expect(getRetryCount(TEST_DIR, "task-2")).toBe(1)
    })
  })

  describe("resetAllRetries", () => {
    test("resets all task counts", () => {
      //#given - multiple tasks with retries
      incrementRetry(TEST_DIR, "task-1")
      incrementRetry(TEST_DIR, "task-2")
      incrementRetry(TEST_DIR, "task-3")
      //#when - reset all
      resetAllRetries(TEST_DIR)
      //#then - all counts are 0
      expect(getRetryCount(TEST_DIR, "task-1")).toBe(0)
      expect(getRetryCount(TEST_DIR, "task-2")).toBe(0)
      expect(getRetryCount(TEST_DIR, "task-3")).toBe(0)
    })
  })

  describe("getBlockedTasks", () => {
    test("returns empty array when no blocked tasks", () => {
      //#given - no retries
      //#when - get blocked tasks
      const blocked = getBlockedTasks(TEST_DIR)
      //#then - empty array
      expect(blocked).toEqual([])
    })

    test("returns tasks that reached max retries", () => {
      //#given - some tasks at max, some not
      for (let i = 0; i < 3; i++) incrementRetry(TEST_DIR, "blocked-1")
      for (let i = 0; i < 3; i++) incrementRetry(TEST_DIR, "blocked-2")
      incrementRetry(TEST_DIR, "not-blocked")
      //#when - get blocked tasks
      const blocked = getBlockedTasks(TEST_DIR)
      //#then - only blocked tasks returned
      expect(blocked).toContain("blocked-1")
      expect(blocked).toContain("blocked-2")
      expect(blocked).not.toContain("not-blocked")
    })

    test("uses custom max when provided", () => {
      //#given - task with 2 retries
      incrementRetry(TEST_DIR, "task-1")
      incrementRetry(TEST_DIR, "task-1")
      //#when - get blocked with custom max of 2
      const blocked = getBlockedTasks(TEST_DIR, 2)
      //#then - task is blocked
      expect(blocked).toContain("task-1")
    })
  })

  describe("getRetryInfo", () => {
    test("returns null for non-existent task", () => {
      //#given - no retries
      //#when - get info
      const info = getRetryInfo(TEST_DIR, "non-existent")
      //#then - returns null
      expect(info).toBeNull()
    })

    test("returns complete info for existing task", () => {
      //#given - task with retries
      incrementRetry(TEST_DIR, "task-1", "Test reason")
      //#when - get info
      const info = getRetryInfo(TEST_DIR, "task-1")
      //#then - has all fields
      expect(info).not.toBeNull()
      expect(info?.count).toBe(1)
      expect(info?.lastAttempt).toBeDefined()
      expect(info?.reason).toBe("Test reason")
    })
  })

  describe("persistence", () => {
    test("state persists across calls", () => {
      //#given - increment retry
      incrementRetry(TEST_DIR, "task-1")
      //#when - read in new context (simulated by direct call)
      const count = getRetryCount(TEST_DIR, "task-1")
      //#then - state is persisted
      expect(count).toBe(1)
    })
  })
})
