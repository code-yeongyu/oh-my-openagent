import { describe, expect, test, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  readContinuationMarker,
  setContinuationMarkerSource,
  clearContinuationMarker,
  isContinuationMarkerActive,
  getActiveContinuationMarkerReason,
} from "./storage"

describe("run-continuation-state", () => {
  const TEST_DIR = join(tmpdir(), "run-continuation-state-test-" + Date.now())

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe("readContinuationMarker", () => {
    test("should return null when no marker file exists", () => {
      //#given - empty temp directory
      mkdirSync(TEST_DIR, { recursive: true })

      //#when
      const result = readContinuationMarker(TEST_DIR, "ses-abc123")

      //#then
      expect(result).toBeNull()
    })

    test("should read marker after writing it", () => {
      //#given - a marker written for a session
      mkdirSync(TEST_DIR, { recursive: true })
      setContinuationMarkerSource(TEST_DIR, "ses-abc123", "todo", "active", "working on tasks")

      //#when
      const result = readContinuationMarker(TEST_DIR, "ses-abc123")

      //#then
      expect(result).not.toBeNull()
      expect(result?.sessionID).toBe("ses-abc123")
      expect(result?.sources.todo?.state).toBe("active")
      expect(result?.sources.todo?.reason).toBe("working on tasks")
    })
  })

  describe("setContinuationMarkerSource", () => {
    test("should create marker with source entry", () => {
      //#given - fresh temp directory
      mkdirSync(TEST_DIR, { recursive: true })

      //#when
      const marker = setContinuationMarkerSource(TEST_DIR, "ses-xyz", "stop", "stopped", "user requested stop")

      //#then
      expect(marker.sessionID).toBe("ses-xyz")
      expect(marker.sources.stop?.state).toBe("stopped")
      expect(marker.sources.stop?.reason).toBe("user requested stop")
      expect(marker.updatedAt).toBeDefined()
    })

    test("should update existing marker without losing other sources", () => {
      //#given - marker with todo source already set
      mkdirSync(TEST_DIR, { recursive: true })
      setContinuationMarkerSource(TEST_DIR, "ses-multi", "todo", "active", "todos pending")

      //#when - add stop source
      const marker = setContinuationMarkerSource(TEST_DIR, "ses-multi", "stop", "idle")

      //#then - both sources present
      expect(marker.sources.todo?.state).toBe("active")
      expect(marker.sources.stop?.state).toBe("idle")
    })

    test("should create marker without reason when not provided", () => {
      //#given - fresh temp directory
      mkdirSync(TEST_DIR, { recursive: true })

      //#when
      const marker = setContinuationMarkerSource(TEST_DIR, "ses-noreason", "todo", "idle")

      //#then
      expect(marker.sources.todo?.reason).toBeUndefined()
      expect(marker.sources.todo?.state).toBe("idle")
    })
  })

  describe("isContinuationMarkerActive", () => {
    test("should return true when any source is active", () => {
      //#given - marker with one active source
      mkdirSync(TEST_DIR, { recursive: true })
      const marker = setContinuationMarkerSource(TEST_DIR, "ses-active", "todo", "active", "tasks remain")

      //#when
      const result = isContinuationMarkerActive(marker)

      //#then
      expect(result).toBe(true)
    })

    test("should return false when all sources are idle or stopped", () => {
      //#given - marker with idle and stopped sources
      mkdirSync(TEST_DIR, { recursive: true })
      setContinuationMarkerSource(TEST_DIR, "ses-inactive", "todo", "idle")
      const marker = setContinuationMarkerSource(TEST_DIR, "ses-inactive", "stop", "stopped")

      //#when
      const result = isContinuationMarkerActive(marker)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("getActiveContinuationMarkerReason", () => {
    test("should return reason from active source", () => {
      //#given - marker with active source and reason
      mkdirSync(TEST_DIR, { recursive: true })
      const marker = setContinuationMarkerSource(TEST_DIR, "ses-reason", "todo", "active", "3 todos remaining")

      //#when
      const reason = getActiveContinuationMarkerReason(marker)

      //#then
      expect(reason).toBe("3 todos remaining")
    })

    test("should return null when no active source has a reason", () => {
      //#given - marker with idle source
      mkdirSync(TEST_DIR, { recursive: true })
      const marker = setContinuationMarkerSource(TEST_DIR, "ses-noreason2", "todo", "idle")

      //#when
      const reason = getActiveContinuationMarkerReason(marker)

      //#then
      expect(reason).toBeNull()
    })
  })

  describe("clearContinuationMarker", () => {
    test("should remove marker file", () => {
      //#given - existing marker
      mkdirSync(TEST_DIR, { recursive: true })
      setContinuationMarkerSource(TEST_DIR, "ses-clear", "todo", "active")

      //#when
      clearContinuationMarker(TEST_DIR, "ses-clear")
      const result = readContinuationMarker(TEST_DIR, "ses-clear")

      //#then
      expect(result).toBeNull()
    })

    test("should not throw when marker does not exist", () => {
      //#given - no marker file
      mkdirSync(TEST_DIR, { recursive: true })

      //#when + then - should not throw
      expect(() => clearContinuationMarker(TEST_DIR, "ses-nonexistent")).not.toThrow()
    })
  })
})
