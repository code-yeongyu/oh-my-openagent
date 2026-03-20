declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")
import { __resetTimingConfig, __setTimingConfig, getDefaultSyncPollTimeoutMs, getTimingConfig } from "./timing"

describe("timing sync poll timeout defaults", () => {
  test("default sync timeout is 30 minutes", () => {
    // #given
    __resetTimingConfig()

    // #when
    const timeout = getDefaultSyncPollTimeoutMs()

    // #then
    expect(timeout).toBe(30 * 60 * 1000)
  })

  test("default sync timeout accessor follows MAX_POLL_TIME_MS config", () => {
    // #given
    __resetTimingConfig()

    // #when
    __setTimingConfig({ MAX_POLL_TIME_MS: 123_456 })

    // #then
    expect(getDefaultSyncPollTimeoutMs()).toBe(123_456)

    __resetTimingConfig()
  })
})

  describe("WAIT_FOR_SESSION_TIMEOUT_MS default", () => {
  test("default wait for session timeout is 1 minute", () => {
    // #given
    __resetTimingConfig()

    // #when
    const config = getTimingConfig()

    // #then
    expect(config.WAIT_FOR_SESSION_TIMEOUT_MS).toBe(60_000)
  })
})
