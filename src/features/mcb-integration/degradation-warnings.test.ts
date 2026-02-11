import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as logger from "../../shared/logger"
import { emitMcbDegradationWarning, resetWarningState } from "./degradation-warnings"

describe("mcb-integration/degradation-warnings", () => {
  let warnSpy: ReturnType<typeof spyOn>
  let logSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    resetWarningState()
    warnSpy = spyOn(console, "warn").mockImplementation(() => {})
    logSpy = spyOn(logger, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    logSpy.mockRestore()
  })

  //#given a tool degradation event
  //#when a warning is emitted
  //#then it logs to console and file logger
  it("emits warning and logs it", () => {
    emitMcbDegradationWarning("memory")
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledTimes(1)
    const message = warnSpy.mock.calls[0]?.[0]
    expect(String(message)).toContain("memory")
    expect(String(message)).toContain("Affected capabilities")
  })

  //#given repeated degradation events for the same tool
  //#when warning emission is requested twice
  //#then only the first warning is emitted
  it("deduplicates warnings by tool", () => {
    emitMcbDegradationWarning("search")
    emitMcbDegradationWarning("search")
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  //#given warning state was reset
  //#when the same tool warning is emitted again
  //#then warning is emitted again
  it("allows re-emission after reset", () => {
    emitMcbDegradationWarning("validate")
    resetWarningState()
    emitMcbDegradationWarning("validate")
    expect(warnSpy).toHaveBeenCalledTimes(2)
    expect(logSpy).toHaveBeenCalledTimes(2)
  })
})
