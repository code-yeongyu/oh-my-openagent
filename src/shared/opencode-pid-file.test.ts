/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

mock.module("./logger", () => ({ log: (..._args: unknown[]) => {} }))

import {
  clearOpencodePidFile,
  isProcessAlive,
  readOpencodePidFile,
  registerOpencodePidFileCleanup,
  writeOpencodePidFile,
} from "./opencode-pid-file"

const TEST_TMP_DIR = join(tmpdir(), `omo-pid-file-test-${process.pid}`)
const TEST_PID_FILE = join(TEST_TMP_DIR, "server.pid")

beforeEach(() => {
  mkdirSync(TEST_TMP_DIR, { recursive: true })
  process.env["OPENCODE_PID_FILE"] = TEST_PID_FILE
})

afterEach(() => {
  delete process.env["OPENCODE_PID_FILE"]
  try {
    rmSync(TEST_TMP_DIR, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
})

describe("writeOpencodePidFile + readOpencodePidFile", () => {
  test("roundtrip: written values are read back correctly", () => {
    writeOpencodePidFile("http://127.0.0.1:4096", 12345)
    const result = readOpencodePidFile()
    expect(result).not.toBeNull()
    expect(result!.pid).toBe(12345)
    expect(result!.serverUrl).toBe("http://127.0.0.1:4096")
    expect(result!.writtenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test("uses process.pid when pid argument is omitted", () => {
    writeOpencodePidFile("http://127.0.0.1:4096")
    const result = readOpencodePidFile()
    expect(result!.pid).toBe(process.pid)
  })
})

describe("clearOpencodePidFile", () => {
  test("removes the file that was written", () => {
    writeOpencodePidFile("http://127.0.0.1:4096")
    expect(readOpencodePidFile()).not.toBeNull()
    clearOpencodePidFile()
    expect(readOpencodePidFile()).toBeNull()
  })

  test("is idempotent on a missing file (no throw)", () => {
    expect(() => clearOpencodePidFile()).not.toThrow()
    expect(() => clearOpencodePidFile()).not.toThrow()
  })
})

describe("readOpencodePidFile", () => {
  test("returns null when file does not exist", () => {
    expect(readOpencodePidFile()).toBeNull()
  })
})

describe("registerOpencodePidFileCleanup", () => {
  test("registers handlers for exit, beforeExit, and the kill signals exactly once", () => {
    const calls: Array<[string, unknown]> = []
    const originalOnce = process.once.bind(process)
    const onceStub = ((event: string, listener: unknown) => {
      calls.push([event, listener])
      return process as unknown as NodeJS.Process
    }) as typeof process.once
    process.once = onceStub
    try {
      registerOpencodePidFileCleanup()
      // Second call should be a no-op so duplicate handlers do not stack up
      // when the plugin is reloaded inside the same process.
      registerOpencodePidFileCleanup()
    } finally {
      process.once = originalOnce
    }

    const events = calls.map(([event]) => event).sort()
    expect(events).toEqual(["SIGHUP", "SIGINT", "SIGTERM", "beforeExit", "exit"])
  })
})

describe("isProcessAlive", () => {
  test("returns true for the current process PID", () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  test("returns false for an impossibly large PID", () => {
    expect(isProcessAlive(9_999_999)).toBe(false)
  })
})
