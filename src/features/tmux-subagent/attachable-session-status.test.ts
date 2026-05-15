/// <reference path="../../../bun-test.d.ts" />

import { describe, expect, it } from "bun:test"
import { isAttachableSessionStatus } from "./attachable-session-status"

describe("isAttachableSessionStatus", () => {
  it("accepts idle as attachable", () => {
    // given
    const status = "idle"

    // when
    const result = isAttachableSessionStatus(status)

    // then
    expect(result).toBe(true)
  })

  it("accepts running as attachable", () => {
    // given
    const status = "running"

    // when
    const result = isAttachableSessionStatus(status)

    // then
    expect(result).toBe(true)
  })

  it("accepts busy as attachable (regression #3839)", () => {
    // given — opencode reports a fresh subagent session as `busy` while the
    // task() loop is still streaming its first prompt. Excluding `busy` made
    // `waitForSessionReady` time out before the pane was ever spawned, which
    // produced the 4.0.0 "tmux pane creation fails silently" regression.
    const status = "busy"

    // when
    const result = isAttachableSessionStatus(status)

    // then
    expect(result).toBe(true)
  })

  it("rejects unknown statuses", () => {
    // given
    const status = "starting"

    // when
    const result = isAttachableSessionStatus(status)

    // then
    expect(result).toBe(false)
  })

  it("rejects undefined", () => {
    // given
    const status = undefined

    // when
    const result = isAttachableSessionStatus(status)

    // then
    expect(result).toBe(false)
  })
})
