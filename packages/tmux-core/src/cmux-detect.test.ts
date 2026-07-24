/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  isCmuxCompatEnvironment,
  isTmuxPathCompatibleWithBackend,
  resolveStableTmuxBackend,
} from "./cmux-detect"

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

  it("#given known tmux and cmux executables #when backend compatibility is checked #then mismatches are rejected", () => {
    expect(isTmuxPathCompatibleWithBackend("/usr/bin/tmux", false)).toBe(true)
    expect(isTmuxPathCompatibleWithBackend("/usr/bin/tmux", true)).toBe(false)
    expect(isTmuxPathCompatibleWithBackend("/opt/bin/cmux", true)).toBe(true)
    expect(isTmuxPathCompatibleWithBackend("/opt/bin/cmux", false)).toBe(false)
    expect(isTmuxPathCompatibleWithBackend("test-runner-shim", true)).toBe(true)
  })

  it("#given the default logical tmux alias under cmux #when resolving a stable backend #then it normalizes to cmux compat", async () => {
    const result = await resolveStableTmuxBackend(
      async () => "tmux",
      () => true,
    )

    expect(result).toEqual({ isCmux: true, path: "cmux" })
  })

  it("#given an absolute native tmux path under cmux #when resolving a stable backend #then it rejects the stale executable", async () => {
    const result = await resolveStableTmuxBackend(
      async () => "/usr/bin/tmux",
      () => true,
    )

    expect(result).toBeNull()
  })

  it("#given the backend changes during executable lookup #when resolution completes #then it fails closed", async () => {
    let isCmux = false
    const result = await resolveStableTmuxBackend(
      async () => {
        isCmux = true
        return "cmux"
      },
      () => isCmux,
    )

    expect(result).toBeNull()
  })

  it("#given an ABA lookup returns a cmux path in native mode #when resolution completes #then path validation rejects it", async () => {
    const result = await resolveStableTmuxBackend(
      async () => "cmux",
      () => false,
    )

    expect(result).toBeNull()
  })
})
