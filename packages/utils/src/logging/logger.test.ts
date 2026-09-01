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
})
