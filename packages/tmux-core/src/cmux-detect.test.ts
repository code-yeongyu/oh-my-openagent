/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { isCmuxCompatEnvironment } from "./cmux-detect"

describe("isCmuxCompatEnvironment", () => {
  let savedTmux: string | undefined
  let savedCmuxSocketPath: string | undefined

  beforeEach(() => {
    savedTmux = process.env.TMUX
    savedCmuxSocketPath = process.env.CMUX_SOCKET_PATH
    delete process.env.TMUX
    delete process.env.CMUX_SOCKET_PATH
  })

  afterEach(() => {
    if (savedTmux !== undefined) {
      process.env.TMUX = savedTmux
    } else {
      delete process.env.TMUX
    }
    if (savedCmuxSocketPath !== undefined) {
      process.env.CMUX_SOCKET_PATH = savedCmuxSocketPath
    } else {
      delete process.env.CMUX_SOCKET_PATH
    }
  })

  it("#given TMUX contains cmuxterm #when isCmuxCompatEnvironment called #then returns true", () => {
    // given
    process.env.TMUX = "/tmp/cmuxterm-12345.sock,1234,0"

    // when
    const result = isCmuxCompatEnvironment()

    // then
    expect(result).toBe(true)
  })

  it("#given standard tmux TMUX without cmuxterm #when isCmuxCompatEnvironment called #then returns false (regression guard)", () => {
    // given
    process.env.TMUX = "/tmp/tmux-1000/default,1234,0"

    // when
    const result = isCmuxCompatEnvironment()

    // then
    expect(result).toBe(false)
  })

  it("#given CMUX_SOCKET_PATH set without TMUX #when isCmuxCompatEnvironment called #then returns true", () => {
    // given
    process.env.CMUX_SOCKET_PATH = "/var/run/cmux.sock"
    // TMUX is already unset in beforeEach

    // when
    const result = isCmuxCompatEnvironment()

    // then
    expect(result).toBe(true)
  })
})
