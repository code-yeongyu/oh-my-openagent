import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { createLogger } from "./logger"

const TEST_PREFIX = "omo-utils-logger"

describe("#given a bound utils logger", () => {
  let tempDir: string
  let logFilePath: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${TEST_PREFIX}-`))
    logFilePath = path.join(tempDir, "product.log")
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  test("#when flushed with product data #then it writes the historical timestamp message json line", () => {
    const logger = createLogger({ logFileName: "unused.log", resolveLogFilePath: () => logFilePath })

    logger.log("LOGGER-OK", { qa: true })
    logger._flushForTesting()

    expect(fs.readFileSync(logFilePath, "utf8")).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*Z\] LOGGER-OK \{"qa":true\}\n$/)
  })

  test("#when cyclic data cannot be serialized #then logging swallows the failure and writes no partial line", () => {
    const logger = createLogger({ logFileName: "unused.log", resolveLogFilePath: () => logFilePath })
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic

    expect(() => logger.log("CYCLIC", cyclic)).not.toThrow()
    logger._flushForTesting()

    expect(fs.existsSync(logFilePath)).toBe(false)
  })

  test("#when reset follows a test override #then the default resolved path is restored", () => {
    const defaultLogFilePath = path.join(tempDir, "default.log")
    const overrideLogFilePath = path.join(tempDir, "override.log")
    const logger = createLogger({ logFileName: "default.log", resolveLogFilePath: () => defaultLogFilePath })

    logger._setLoggerForTesting({ filePath: overrideLogFilePath, maxSizeBytes: 1, maxBackups: 1 })
    logger._resetLoggerForTesting()

    expect(logger.getLogFilePath()).toBe(defaultLogFilePath)
  })

  test("#when the logger module is first imported while a fake clock holds globalThis.setTimeout #then its flush still runs on the real clock", async () => {
    // given: a stub clock that records scheduled callbacks and never fires them
    const realSetTimeout = globalThis.setTimeout
    const realClearTimeout = globalThis.clearTimeout
    const stubbed: Array<() => void> = []
    globalThis.setTimeout = ((callback: () => void) => {
      stubbed.push(callback)
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout
    globalThis.clearTimeout = (() => {}) as unknown as typeof clearTimeout
    try {
      // when: a fresh logger module is imported under the stub clock, then logs one line
      const fresh = (await import(`./logger.ts?logger-fake-clock-${Date.now()}`)) as typeof import("./logger")
      const logger = fresh.createLogger({ logFileName: "unused.log", resolveLogFilePath: () => logFilePath })
      logger.log("LOGGER-FAKE-CLOCK", { qa: true })
      // then: the flush was scheduled on the real clock, not on the stub
      expect(stubbed.length).toBe(0)
    } finally {
      globalThis.setTimeout = realSetTimeout
      globalThis.clearTimeout = realClearTimeout
    }
    // then: the real 500 ms flush interval writes the line without any fake-clock advance.
    // Poll for the write with a bounded deadline instead of a fixed sleep: a fixed 900 ms
    // wait leaves the 500 ms flush only a 400 ms margin, so a loaded runner could flake
    // the test and every run pays ~0.9 s.
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      if (fs.existsSync(logFilePath) && fs.readFileSync(logFilePath, "utf8").includes("LOGGER-FAKE-CLOCK")) break
      await Bun.sleep(25)
    }
    expect(fs.readFileSync(logFilePath, "utf8")).toContain("LOGGER-FAKE-CLOCK")
  })
})
