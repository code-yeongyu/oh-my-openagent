import { describe, expect, test } from "bun:test"

import {
  UNCONFIGURED_POSTHOG_API_KEY,
  hasTelemetryApiKey,
  shouldDisableTelemetry,
} from "./index"

const OPT_OUT_CASES = [
  ["unset env enables telemetry", {}, false],
  ["global disable 1", { OMO_DISABLE_POSTHOG: "1" }, true],
  ["global disable true", { OMO_DISABLE_POSTHOG: "true" }, true],
  ["global disable yes", { OMO_DISABLE_POSTHOG: "yes" }, true],
  ["global send 0", { OMO_SEND_ANONYMOUS_TELEMETRY: "0" }, true],
  ["global send false", { OMO_SEND_ANONYMOUS_TELEMETRY: "false" }, true],
  ["global send no", { OMO_SEND_ANONYMOUS_TELEMETRY: "no" }, true],
  ["codex disable 1", { OMO_CODEX_DISABLE_POSTHOG: "1" }, true],
  ["codex disable true", { OMO_CODEX_DISABLE_POSTHOG: "true" }, true],
  ["codex disable yes", { OMO_CODEX_DISABLE_POSTHOG: "yes" }, true],
  ["codex send 0", { OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "0" }, true],
  ["codex send false", { OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "false" }, true],
  ["codex send no", { OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "no" }, true],
  ["approved codex send yes convergence", { OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "yes" }, true],
  ["invalid disable value", { OMO_CODEX_DISABLE_POSTHOG: "maybe" }, false],
] as const

describe("telemetry API key configuration", () => {
  test.each([
    ["empty", "", false],
    ["whitespace-only", "   ", false],
    ["exact unconfigured placeholder", UNCONFIGURED_POSTHOG_API_KEY, false],
    ["longer key containing the placeholder", `${UNCONFIGURED_POSTHOG_API_KEY}_configured`, true],
  ] as const)("#given %s input #when key availability is checked #then the expected result is returned", (_name, apiKey, expected) => {
    expect(hasTelemetryApiKey({ POSTHOG_API_KEY: apiKey })).toBe(expected)
  })
})

describe("opt-out telemetry env matrix", () => {
  test.each(OPT_OUT_CASES)(
    "#given %s #when evaluated #then disabled=%p",
    (_name, env, expected) => {
      // given
      const productPrefix = "OMO_CODEX"

      // when
      const result = shouldDisableTelemetry({ env, productEnvPrefix: productPrefix })

      // then
      expect(result).toBe(expected)
    },
  )
})

describe("DO_NOT_TRACK global opt-out", () => {
  describe("#given DO_NOT_TRACK is 1", () => {
    test.each([
      ["omo-opencode", "OMO_OPENCODE"],
      ["omo-codex", "OMO_CODEX"],
      ["omo-senpi", "OMO_SENPI"],
    ] as const)("#when evaluated for %s #then telemetry is disabled", (_product, productEnvPrefix) => {
      // when
      const result = shouldDisableTelemetry({
        env: { DO_NOT_TRACK: "1" },
        productEnvPrefix,
      })

      // then
      expect(result).toBe(true)
    })
  })

  describe("#given DO_NOT_TRACK uses existing flag normalization", () => {
    test("#when the value is space-padded mixed case #then telemetry is disabled", () => {
      // when
      const result = shouldDisableTelemetry({
        env: { DO_NOT_TRACK: " TRUE " },
        productEnvPrefix: "OMO_SENPI",
      })

      // then
      expect(result).toBe(true)
    })
  })

  describe("#given DO_NOT_TRACK is not an opt-out value", () => {
    test.each([
      ["0", { DO_NOT_TRACK: "0" }],
      ["unset", {}],
    ] as const)("#when the value is %s #then telemetry remains enabled", (_name, env) => {
      // when
      const result = shouldDisableTelemetry({ env, productEnvPrefix: "OMO_SENPI" })

      // then
      expect(result).toBe(false)
    })
  })

  describe("#given the same env object changes between evaluations", () => {
    test("#when DO_NOT_TRACK changes #then each call reads the current value", () => {
      // given
      const env: Record<string, string | undefined> = { DO_NOT_TRACK: "false" }

      // when
      const beforeOptOut = shouldDisableTelemetry({ env, productEnvPrefix: "OMO_SENPI" })
      env.DO_NOT_TRACK = "yes"
      const duringOptOut = shouldDisableTelemetry({ env, productEnvPrefix: "OMO_SENPI" })
      env.DO_NOT_TRACK = ""
      const afterOptOut = shouldDisableTelemetry({ env, productEnvPrefix: "OMO_SENPI" })

      // then
      expect([beforeOptOut, duringOptOut, afterOptOut]).toEqual([false, true, false])
    })
  })
})
