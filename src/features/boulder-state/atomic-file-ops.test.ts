import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { atomicWriteJson, atomicWriteText, withFileLock } from "./atomic-file-ops"

describe("atomic-file-ops", () => {
  const TEST_DIR = join(tmpdir(), "atomic-file-ops-test-" + Date.now())

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe("atomicWriteJson", () => {
    test("should write JSON correctly and be readable", () => {
      // given - data to write
      const filePath = join(TEST_DIR, "test.json")
      const data = { name: "test", value: 42 }

      // when
      atomicWriteJson(filePath, data)

      // then
      const content = readFileSync(filePath, "utf-8")
      const parsed = JSON.parse(content)
      expect(parsed).toEqual(data)
    })

    test("should create parent directories if they don't exist", () => {
      // given - nested path that doesn't exist
      const filePath = join(TEST_DIR, "nested", "deep", "dir", "data.json")
      const data = { test: true }

      // when
      atomicWriteJson(filePath, data)

      // then
      expect(existsSync(filePath)).toBe(true)
      const parsed = JSON.parse(readFileSync(filePath, "utf-8"))
      expect(parsed).toEqual(data)
    })

    test("should not leave temp files after successful write", () => {
      // given - file path
      const filePath = join(TEST_DIR, "clean.json")
      const data = { clean: true }

      // when
      atomicWriteJson(filePath, data)

      // then - no .tmp files should exist
      const files = require("node:fs").readdirSync(TEST_DIR)
      const tmpFiles = files.filter((f: string) => f.includes(".tmp"))
      expect(tmpFiles.length).toBe(0)
    })

  })

  describe("atomicWriteText", () => {
    test("should write text correctly and be readable", () => {
      // given - text content
      const filePath = join(TEST_DIR, "test.txt")
      const content = "Hello, World!"

      // when
      atomicWriteText(filePath, content)

      // then
      const read = readFileSync(filePath, "utf-8")
      expect(read).toBe(content)
    })

    test("should create parent directories if they don't exist", () => {
      // given - nested path
      const filePath = join(TEST_DIR, "nested", "text", "file.txt")
      const content = "nested content"

      // when
      atomicWriteText(filePath, content)

      // then
      expect(existsSync(filePath)).toBe(true)
      expect(readFileSync(filePath, "utf-8")).toBe(content)
    })

    test("should not leave temp files after successful write", () => {
      // given - file path
      const filePath = join(TEST_DIR, "clean.txt")

      // when
      atomicWriteText(filePath, "clean text")

      // then - no .tmp files should exist
      const files = require("node:fs").readdirSync(TEST_DIR)
      const tmpFiles = files.filter((f: string) => f.includes(".tmp"))
      expect(tmpFiles.length).toBe(0)
    })
  })

  describe("withFileLock", () => {
    test("should return the function's return value", () => {
      // given - lock dir and function that returns a value
      const lockDir = join(TEST_DIR, "locks")
      const expectedValue = { result: "success" }

      // when
      const result = withFileLock(lockDir, () => expectedValue)

      // then
      expect(result).toEqual(expectedValue)
    })

    test("should remove lock file after successful execution", () => {
      // given - lock dir
      const lockDir = join(TEST_DIR, "locks")
      const lockPath = join(lockDir, ".lock")

      // when
      withFileLock(lockDir, () => "done")

      // then - lock file should be removed
      expect(existsSync(lockPath)).toBe(false)
    })

    test("should remove lock file even when function throws", () => {
      // given - lock dir and function that throws
      const lockDir = join(TEST_DIR, "locks")
      const lockPath = join(lockDir, ".lock")

      // when/then
      expect(() => {
        withFileLock(lockDir, () => {
          throw new Error("test error")
        })
      }).toThrow("test error")

      // then - lock file should still be removed
      expect(existsSync(lockPath)).toBe(false)
    })

    test("should throw when lock is already held (non-stale)", () => {
      // given - lock dir with recent lock file
      const lockDir = join(TEST_DIR, "locks")
      mkdirSync(lockDir, { recursive: true })
      const lockPath = join(lockDir, ".lock")
      const recentTimestamp = Date.now()
      require("node:fs").writeFileSync(
        lockPath,
        JSON.stringify({ id: "existing-lock", timestamp: recentTimestamp })
      )

      // when/then - should throw because lock is held
      expect(() => {
        withFileLock(lockDir, () => "should not run")
      }).toThrow("Failed to acquire file lock")
    })

    test("should acquire lock when existing lock is stale (>30s old)", () => {
      // given - lock dir with stale lock file (31 seconds old)
      const lockDir = join(TEST_DIR, "locks")
      mkdirSync(lockDir, { recursive: true })
      const lockPath = join(lockDir, ".lock")
      const staleTimestamp = Date.now() - 31_000
      require("node:fs").writeFileSync(
        lockPath,
        JSON.stringify({ id: "stale-lock", timestamp: staleTimestamp })
      )

      // when
      const result = withFileLock(lockDir, () => "acquired")

      // then - should succeed and remove the lock
      expect(result).toBe("acquired")
      expect(existsSync(lockPath)).toBe(false)
    })

    test("should create lock dir if it doesn't exist", () => {
      // given - non-existent lock dir
      const lockDir = join(TEST_DIR, "new", "locks", "dir")

      // when
      withFileLock(lockDir, () => "done")

      // then - dir should be created
      expect(existsSync(lockDir)).toBe(true)
    })
  })
})
