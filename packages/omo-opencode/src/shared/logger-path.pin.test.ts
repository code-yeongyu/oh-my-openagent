/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { _flushForTesting, _resetLoggerForTesting, _setLoggerForTesting, getLogFilePath, log } from "./logger"

const TEST_PREFIX = "oh-my-opencode-logger-path-pin"

describe("#given the OpenCode logger shim defaults", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${TEST_PREFIX}-`))
    _resetLoggerForTesting()
  })

  afterEach(() => {
    _resetLoggerForTesting()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  test("#when the logger is reset #then the default path is byte-identical to the historical temp path", () => {
    // given
    const expectedPath = path.join(os.tmpdir(), "oh-my-opencode.log")

    // when
    const actualPath = getLogFilePath()

    // then
    expect(actualPath).toBe(expectedPath)
  })

  test("#when an entry with data is flushed #then the line keeps the historical timestamp message json format", () => {
    // given
    const logFilePath = path.join(tempDir, "pinned.log")
    _setLoggerForTesting({ filePath: logFilePath, maxSizeBytes: 1024 * 1024, maxBackups: 2 })

    // when
    log("LOGGER-OK", { qa: true })
    _flushForTesting()

    // then
    const contents = fs.readFileSync(logFilePath, "utf8")
    expect(contents).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*Z\] LOGGER-OK \{"qa":true\}\n$/)
  })
})
