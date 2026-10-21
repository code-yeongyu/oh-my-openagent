import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { TELEMETRY_CONSENT_FILE_ENV, writeTelemetryConsentState } from "@oh-my-opencode/telemetry-core"

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

let consentRoots: string[] = []

/** An answer has to be pointed at a temp file: the real `~/.omo/state` belongs to whoever runs the suite. */
function answerConsent(enabled: boolean): void {
  const root = mkdtempSync(join(tmpdir(), "omo-pr-b-codex-consent-"))
  consentRoots.push(root)
  process.env[TELEMETRY_CONSENT_FILE_ENV] = join(root, "telemetry.json")
  writeTelemetryConsentState(process.env[TELEMETRY_CONSENT_FILE_ENV] as string, { enabled })
}

beforeEach(() => {
  clearTelemetryEnv()
  delete process.env[TELEMETRY_CONSENT_FILE_ENV]
})

afterEach(() => {
  clearTelemetryEnv()
  delete process.env[TELEMETRY_CONSENT_FILE_ENV]
  for (const root of consentRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("shouldDisablePostHog", () => {
  it("returns true when no env vars are set and nobody has answered", () => {
    // given
    clearTelemetryEnv()

    // when
    const result = shouldDisablePostHog()

    // then
    expect(result).toBe(true)
  })

  it("returns false when the machine answered yes and no env var says otherwise", () => {
    // given
    answerConsent(true)

    // when
    const result = shouldDisablePostHog()

    // then
    expect(result).toBe(false)
  })

  it("returns true when the machine answered yes and a disable flag is set", () => {
    // given
    answerConsent(true)
    process.env.OMO_DISABLE_POSTHOG = "1"

    // when
    const result = shouldDisablePostHog()

    // then
    expect(result).toBe(true)
  })

  it("returns true when the machine answered no", () => {
    // given
    answerConsent(false)

    // when
    const result = shouldDisablePostHog()

    // then
    expect(result).toBe(true)
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

  it("returns true when OMO_DISABLE_POSTHOG is 0, because 0 does not opt in", () => {
    // given
    process.env.OMO_DISABLE_POSTHOG = "0"

    // when
    const result = shouldDisablePostHog()

    // then
    expect(result).toBe(true)
  })

  it("returns false when OMO_SEND_ANONYMOUS_TELEMETRY is 1", () => {
    // given
    process.env.OMO_SEND_ANONYMOUS_TELEMETRY = "1"

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
    process.env.OMO_SEND_ANONYMOUS_TELEMETRY = "1"
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
