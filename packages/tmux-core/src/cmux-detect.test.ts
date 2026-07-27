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

  it("#given cmux injected TMUX under a cmux socket directory #when isCmuxCompatEnvironment called #then returns true", () => {
    // given
    process.env.CMUX_SOCKET_PATH = "/Users/someone/.local/state/cmux/cmux-501.sock"
    process.env.TMUX = "/tmp/cmux-omo/70D4AC33-11CD-4B66-926C-C72CEFEC7E60,EEC79E0A-E474-4386-B185-8B6652A9E55F,473026479299511386"

    // when
    const result = isCmuxCompatEnvironment()

    // then
    expect(result).toBe(true)
  })

  it("#given real tmux nested inside cmux #when isCmuxCompatEnvironment called #then returns false (regression guard)", () => {
    // given
    process.env.CMUX_SOCKET_PATH = "/tmp/cmux.sock"
    process.env.TMUX = "/private/tmp/tmux-501/default,123,0"

    // when
    const result = isCmuxCompatEnvironment()

    // then
    expect(result).toBe(false)
  })

  it("#given cmux socket directory TMUX without CMUX_SOCKET_PATH #when isCmuxCompatEnvironment called #then returns false", () => {
    // given
    process.env.TMUX = "/tmp/cmux-omo/workspace,surface,pane"

    // when
    const result = isCmuxCompatEnvironment()

    // then
    expect(result).toBe(false)
  })

  it("#given neither TMUX nor CMUX_SOCKET_PATH #when isCmuxCompatEnvironment called #then returns false", () => {
    // given
    // both are already unset in beforeEach

    // when
    const result = isCmuxCompatEnvironment()

    // then
    expect(result).toBe(false)
  })
})
