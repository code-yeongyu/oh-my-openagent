import { afterEach, describe, expect, it } from "bun:test"

import { shouldDisablePostHog } from "./env-flags"

const TELEMETRY_ENV_KEYS = [
  "OMO_DISABLE_POSTHOG",
  "OMO_SEND_ANONYMOUS_TELEMETRY",
  "OMO_CODEX_DISABLE_POSTHOG",
  "OMO_CODEX_SEND_ANONYMOUS_TELEMETRY",
] as const

function clearTelemetryEnv(): void {
  for (const envKey of TELEMETRY_ENV_KEYS) {
    delete process.env[envKey]
  }
}

afterEach(() => {
  clearTelemetryEnv()
})

describe("shouldDisablePostHog", () => {
  it("returns false when no env vars are set", () => {
    // given
    clearTelemetryEnv()

    // when
    const result = shouldDisablePostHog()

    // then
    expect(result).toBe(false)
  })

  it("returns true when OMO_DISABLE_POSTHOG is 1", () => {
    // given
    process.env.OMO_DISABLE_POSTHOG = "1"

    // when
    const result = shouldDisablePostHog()

    // then
    expect(result).toBe(true)
  })

  it("returns true when OMO_DISABLE_POSTHOG is true", () => {
    // given
    process.env.OMO_DISABLE_POSTHOG = "true"

    // when
    const result = shouldDisablePostHog()

    // then
    expect(result).toBe(true)
  })

  it("returns false when OMO_DISABLE_POSTHOG is 0", () => {
    // given
    process.env.OMO_DISABLE_POSTHOG = "0"

    // when
    const result = shouldDisablePostHog()

    // then
    expect(result).toBe(false)
  })

  it("returns true when OMO_SEND_ANONYMOUS_TELEMETRY is 0", () => {
    // given
    process.env.OMO_SEND_ANONYMOUS_TELEMETRY = "0"

    // when
    const result = shouldDisablePostHog()

    // then
    expect(result).toBe(true)
  })

  it("returns true when OMO_SEND_ANONYMOUS_TELEMETRY is false", () => {
    // given
    process.env.OMO_SEND_ANONYMOUS_TELEMETRY = "false"

    // when
    const result = shouldDisablePostHog()

    // then
    expect(result).toBe(true)
  })

  it("returns true when OMO_SEND_ANONYMOUS_TELEMETRY is no", () => {
    // given
    process.env.OMO_SEND_ANONYMOUS_TELEMETRY = "no"

    // when
    const result = shouldDisablePostHog()

    // then
    expect(result).toBe(true)
  })

  it("returns true when OMO_CODEX_DISABLE_POSTHOG is 1", () => {
    // given
    process.env.OMO_CODEX_DISABLE_POSTHOG = "1"

    // when
    const result = shouldDisablePostHog()

    // then
    expect(result).toBe(true)
  })

  it("returns true when OMO_CODEX_SEND_ANONYMOUS_TELEMETRY is 0", () => {
    // given
    process.env.OMO_CODEX_SEND_ANONYMOUS_TELEMETRY = "0"

    // when
    const result = shouldDisablePostHog()

    // then
    expect(result).toBe(true)
  })

  it("returns true when global telemetry is enabled but codex-specific disable is set", () => {
    // given
    process.env.OMO_DISABLE_POSTHOG = "0"
    process.env.OMO_CODEX_DISABLE_POSTHOG = "1"

    // when
    const result = shouldDisablePostHog()

    // then
    expect(result).toBe(true)
  })

  it("returns true when codex-specific telemetry is enabled but global disable is set", () => {
    // given
    process.env.OMO_CODEX_DISABLE_POSTHOG = "0"
    process.env.OMO_DISABLE_POSTHOG = "1"

    // when
    const result = shouldDisablePostHog()

    // then
    expect(result).toBe(true)
  })
})
