/// <reference types="bun-types" />

// This test file mutates the logger module's singleton state. It must run in an
// isolated CI batch so that other test files mocking `./shared` (the barrel that
// re-exports this logger) cannot leak a no-op `log` into our imports. See
// script/run-ci-tests.ts — the `mock.module(` substring routes the file out of
// the shared batch.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
mock.module("./logger-test-isolation", () => ({}))

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

type LoggerModule = typeof import("./logger")

const TEST_PREFIX = "oh-my-opencode-logger-test"

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${TEST_PREFIX}-`))
}

describe("#given the shared logger", () => {
  let tempDir: string
  let logFilePath: string
  let loggerModule: LoggerModule

  beforeEach(async () => {
    mock.restore()
    tempDir = makeTempDir()
    logFilePath = path.join(tempDir, "log.txt")
    loggerModule = await import(`./logger?test=${Date.now()}-${Math.random()}`)
  })

  afterEach(() => {
    loggerModule._resetLoggerForTesting()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe("#given log file size under threshold", () => {
    test("#when log() is called and flushed #then the file is not rotated", () => {
      loggerModule._setLoggerForTesting({ filePath: logFilePath, maxSizeBytes: 1024, maxBackups: 2 })

      loggerModule.log("small entry")
      loggerModule._flushForTesting()

      expect(fs.existsSync(logFilePath)).toBe(true)
      expect(fs.existsSync(`${logFilePath}.1`)).toBe(false)
    })
  })

  describe("#given log file size over threshold", () => {
    test("#when next flush runs #then the file rotates to .1 and a fresh file is created", () => {
      loggerModule._setLoggerForTesting({ filePath: logFilePath, maxSizeBytes: 100, maxBackups: 2 })

      // Pre-fill the log file beyond the threshold so the next flush triggers rotation.
      fs.writeFileSync(logFilePath, "x".repeat(200))

      loggerModule.log("after rotation")
      loggerModule._flushForTesting()

      // flush() appends first, then rotates — the in-flight batch becomes part
      // of .1 so the post-flush primary is bounded to ≤ cap. The primary path
      // is left absent after rotation; the next log() will re-create it on
      // its next flush.
      expect(fs.existsSync(`${logFilePath}.1`)).toBe(true)
      const rotated = fs.readFileSync(`${logFilePath}.1`, "utf8")
      expect(rotated).toContain("xxxx")
      expect(rotated).toContain("after rotation")
      expect(rotated.length).toBeGreaterThan(200)

      expect(fs.existsSync(logFilePath)).toBe(false)

      // A subsequent log() recreates the primary on its flush.
      loggerModule.log("after recreation")
      loggerModule._flushForTesting()
      expect(fs.existsSync(logFilePath)).toBe(true)
      expect(fs.readFileSync(logFilePath, "utf8")).toContain("after recreation")
    })

    test("#when rotation happens repeatedly #then only maxBackups files are kept and the ladder shifts in order", () => {
      loggerModule._setLoggerForTesting({ filePath: logFilePath, maxSizeBytes: 100, maxBackups: 2 })

      // First rotation
      fs.writeFileSync(logFilePath, "first".repeat(50))
      loggerModule.log("entry-A")
      loggerModule._flushForTesting()
      expect(fs.existsSync(`${logFilePath}.1`)).toBe(true)
      expect(fs.existsSync(`${logFilePath}.2`)).toBe(false)

      // Second rotation
      fs.writeFileSync(logFilePath, "second".repeat(50))
      loggerModule.log("entry-B")
      loggerModule._flushForTesting()
      expect(fs.existsSync(`${logFilePath}.1`)).toBe(true)
      expect(fs.existsSync(`${logFilePath}.2`)).toBe(true)
      // The previous .1 (containing entry-A) should now live at .2 — assert the
      // ladder shifts in the expected direction so a regression that reverses
      // the loop (.2 → .1) would fail here, not just silently keep two files.
      expect(fs.readFileSync(`${logFilePath}.2`, "utf8")).toContain("entry-A")
      expect(fs.readFileSync(`${logFilePath}.1`, "utf8")).toContain("entry-B")

      // Third rotation should drop the oldest (.2) and shift .1 -> .2
      fs.writeFileSync(logFilePath, "third".repeat(50))
      loggerModule.log("entry-C")
      loggerModule._flushForTesting()
      expect(fs.existsSync(`${logFilePath}.1`)).toBe(true)
      expect(fs.existsSync(`${logFilePath}.2`)).toBe(true)
      expect(fs.existsSync(`${logFilePath}.3`)).toBe(false)
      // entry-A (oldest) was dropped; entry-B shifted from .1 to .2; entry-C is now .1.
      expect(fs.readFileSync(`${logFilePath}.2`, "utf8")).toContain("entry-B")
      expect(fs.readFileSync(`${logFilePath}.1`, "utf8")).toContain("entry-C")

      // Total worst-case files on disk: primary + 2 backups
      const survivors = fs
        .readdirSync(tempDir)
        .filter((name) => name.startsWith(path.basename(logFilePath)))
      expect(survivors.length).toBeLessThanOrEqual(3)
    })

    test("#when log() is called past BUFFER_SIZE_LIMIT without explicit flush #then the inline flush path writes to disk", () => {
      // BUFFER_SIZE_LIMIT in logger.ts is 50 — past that, log() flushes
      // synchronously rather than scheduling a timer. A regression that drops
      // the inline flush in favor of always scheduling would only surface here.
      loggerModule._setLoggerForTesting({ filePath: logFilePath, maxSizeBytes: 1024 * 1024, maxBackups: 2 })

      for (let i = 0; i < 100; i += 1) {
        loggerModule.log(`entry-${i}`)
      }
      // Note: no _flushForTesting() — relies on the inline flush at i=49 and i=99.

      expect(fs.existsSync(logFilePath)).toBe(true)
      const contents = fs.readFileSync(logFilePath, "utf8")
      expect(contents).toContain("entry-0")
      expect(contents).toContain("entry-99")
    })
  })

  describe("#given filesystem failures during flush", () => {
    test("#when the parent directory is missing #then append fails silently and does not throw", () => {
      loggerModule._setLoggerForTesting({
        filePath: path.join(tempDir, "no-such-dir", "log.txt"),
        maxSizeBytes: 10,
        maxBackups: 2,
      })

      expect(() => {
        loggerModule.log("entry")
        loggerModule._flushForTesting()
      }).not.toThrow()
    })

    test("#when rotation fails partway through #then log() does not throw and primary keeps the entry", () => {
      loggerModule._setLoggerForTesting({ filePath: logFilePath, maxSizeBytes: 10, maxBackups: 2 })

      // Pre-fill primary past the cap so rotateLogFileIfNeeded() actually triggers.
      fs.writeFileSync(logFilePath, "x".repeat(200))
      // Sabotage the oldest-eviction step: occupy the `.2` slot with a directory so
      // unlinkSync inside rotateLogFileIfNeeded throws, exercising its inner catch.
      // Portable: unlinkSync on a directory throws EISDIR on Linux/macOS and
      // EPERM/EISDIR on Windows — both hit the catch.
      fs.mkdirSync(`${logFilePath}.2`)

      expect(() => {
        loggerModule.log("entry")
        loggerModule._flushForTesting()
      }).not.toThrow()

      // appendFileSync succeeded; rotation failed silently; the primary still holds
      // the new entry (rotation didn't move it) — confirms we reached the rotation
      // path and recovered cleanly rather than short-circuiting on append failure.
      expect(fs.readFileSync(logFilePath, "utf8")).toContain("entry")
    })
  })

  describe("#given default configuration", () => {
    test("#when getLogFilePath is called #then it points at os.tmpdir()", () => {
      loggerModule._resetLoggerForTesting()
      expect(loggerModule.getLogFilePath().startsWith(os.tmpdir())).toBe(true)
    })
  })
})
