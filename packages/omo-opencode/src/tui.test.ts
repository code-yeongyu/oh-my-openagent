/// <reference types="bun-types" />

import { describe, expect, it, jest } from "bun:test"

import * as logger from "./shared/logger"
import { handleTuiPollError } from "./tui"

describe("TUI sidebar polling", () => {
  it("#given an unexpected Error during polling #when the poll error handler runs #then the error is logged", () => {
    // given
    const pollError = new TypeError("view derivation failed")
    const logSpy = jest.spyOn(logger, "log").mockImplementation(() => {})

    // when
    handleTuiPollError(pollError)

    // then
    expect(logSpy).toHaveBeenCalledWith("[tui-sidebar] polling failed", { error: pollError })
    logSpy.mockRestore()
  })

  it("#given a non-Error throw during polling #when the poll error handler runs #then the value is rethrown", () => {
    // given
    const thrownValue = "bad poll state"

    expect(() => handleTuiPollError(thrownValue)).toThrow(thrownValue)
  })
})
