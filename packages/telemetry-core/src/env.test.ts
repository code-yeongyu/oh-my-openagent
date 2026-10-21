import { describe, expect, test } from "bun:test"

import {
  UNCONFIGURED_POSTHOG_API_KEY,
  hasTelemetryApiKey,
  resolveTelemetryEnvDecision,
  shouldDisableTelemetry,
} from "./index"

const OPT_OUT_CASES = [
  ["unset env leaves telemetry disabled", {}, true],
  ["global disable 1", { OMO_DISABLE_POSTHOG: "1" }, true],
  ["global disable true", { OMO_DISABLE_POSTHOG: "true" }, true],
  ["global disable yes", { OMO_DISABLE_POSTHOG: "yes" }, true],
  ["global disable trims and lowercases", { OMO_DISABLE_POSTHOG: " TRUE " }, true],
  ["global send 0", { OMO_SEND_ANONYMOUS_TELEMETRY: "0" }, true],
  ["global send false", { OMO_SEND_ANONYMOUS_TELEMETRY: "false" }, true],
  ["global send no", { OMO_SEND_ANONYMOUS_TELEMETRY: "no" }, true],
  ["global send trims and lowercases", { OMO_SEND_ANONYMOUS_TELEMETRY: " No " }, true],
  ["codex disable 1", { OMO_CODEX_DISABLE_POSTHOG: "1" }, true],
  ["codex disable true", { OMO_CODEX_DISABLE_POSTHOG: "true" }, true],
  ["codex disable yes", { OMO_CODEX_DISABLE_POSTHOG: "yes" }, true],
  ["codex disable trims and lowercases", { OMO_CODEX_DISABLE_POSTHOG: " YES " }, true],
  ["codex send 0", { OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "0" }, true],
  ["codex send false", { OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "false" }, true],
  ["codex send no", { OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "no" }, true],
  ["codex send trims and lowercases", { OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: " FALSE " }, true],
  ["approved codex send yes convergence", { OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "yes" }, true],
  ["invalid disable value", { OMO_CODEX_DISABLE_POSTHOG: "maybe" }, true],
  ["global telemetry disable 1", { OMO_DISABLE_TELEMETRY: "1" }, true],
  ["global telemetry disable true", { OMO_DISABLE_TELEMETRY: "true" }, true],
  ["global telemetry disable yes", { OMO_DISABLE_TELEMETRY: "yes" }, true],
  ["global telemetry disable trims and lowercases", { OMO_DISABLE_TELEMETRY: " Yes " }, true],
  ["global telemetry disable 0 does not opt in", { OMO_DISABLE_TELEMETRY: "0" }, true],
  ["global telemetry disable empty does not opt in", { OMO_DISABLE_TELEMETRY: "" }, true],
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

describe("opt-in telemetry env matrix", () => {
  describe("#given the environment says nothing", () => {
    test("#when no consent answer exists #then telemetry is disabled", () => {
      // given
      const input = { env: {}, productEnvPrefix: "OMO_CODEX" } as const

      // when
      const decision = resolveTelemetryEnvDecision(input)

      // then
      expect(decision).toBe("unset")
      expect(shouldDisableTelemetry(input)).toBe(true)
    })

    test("#when the machine answered yes #then telemetry is enabled", () => {
      // when
      const result = shouldDisableTelemetry({ consentEnabled: true, env: {}, productEnvPrefix: "OMO_CODEX" })

      // then
      expect(result).toBe(false)
    })

    test("#when the machine answered no #then telemetry stays disabled", () => {
      // when
      const result = shouldDisableTelemetry({ consentEnabled: false, env: {}, productEnvPrefix: "OMO_CODEX" })

      // then
      expect(result).toBe(true)
    })
  })

  describe("#given a force-on flag", () => {
    test.each([
      ["global 1", { OMO_SEND_ANONYMOUS_TELEMETRY: "1" }],
      ["global true", { OMO_SEND_ANONYMOUS_TELEMETRY: "true" }],
      ["the product prefix", { OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "1" }],
      ["trims and lowercases", { OMO_SEND_ANONYMOUS_TELEMETRY: " TRUE " }],
    ] as const)("#when %s is set #then the decision is opt_in and telemetry is enabled", (_name, env) => {
      // given
      const input = { consentEnabled: false, env, productEnvPrefix: "OMO_CODEX" } as const

      // when
      const decision = resolveTelemetryEnvDecision(input)

      // then
      expect(decision).toBe("opt_in")
      expect(shouldDisableTelemetry(input)).toBe(false)
    })

    test("#when yes is set #then it keeps its long-standing opt-out meaning", () => {
      // given
      const input = { consentEnabled: true, env: { OMO_SEND_ANONYMOUS_TELEMETRY: "yes" }, productEnvPrefix: "OMO_CODEX" } as const

      // when
      const decision = resolveTelemetryEnvDecision(input)

      // then
      expect(decision).toBe("disable")
    })
  })

  describe("#given a force-on flag and a disable flag together", () => {
    test.each([
      ["the global disable posthog flag", { OMO_DISABLE_POSTHOG: "1", OMO_SEND_ANONYMOUS_TELEMETRY: "1" }],
      ["the product disable posthog flag", { OMO_CODEX_DISABLE_POSTHOG: "1", OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "1" }],
      ["do not track", { DO_NOT_TRACK: "1", OMO_SEND_ANONYMOUS_TELEMETRY: "1" }],
      ["the global disable telemetry flag", { OMO_DISABLE_TELEMETRY: "1", OMO_SEND_ANONYMOUS_TELEMETRY: "1" }],
    ] as const)("#when %s is also set #then disable wins", (_name, env) => {
      // given
      const input = { consentEnabled: true, env, productEnvPrefix: "OMO_CODEX" } as const

      // when
      const decision = resolveTelemetryEnvDecision(input)

      // then
      expect(decision).toBe("disable")
      expect(shouldDisableTelemetry(input)).toBe(true)
    })
  })
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
    ] as const)("#when the value is %s #then the env decision is unset and telemetry still needs an opt-in", (_name, env) => {
      // given
      const input = { env, productEnvPrefix: "OMO_SENPI" } as const

      // when
      const decision = resolveTelemetryEnvDecision(input)

      // then
      expect(decision).toBe("unset")
      expect(shouldDisableTelemetry(input)).toBe(true)
    })
  })

  describe("#given the same env object changes between evaluations", () => {
    test("#when DO_NOT_TRACK changes #then each call reads the current value", () => {
      // given
      const env: Record<string, string | undefined> = { DO_NOT_TRACK: "false" }

      // when
      const beforeOptOut = shouldDisableTelemetry({ consentEnabled: true, env, productEnvPrefix: "OMO_SENPI" })
      env.DO_NOT_TRACK = "yes"
      const duringOptOut = shouldDisableTelemetry({ consentEnabled: true, env, productEnvPrefix: "OMO_SENPI" })
      env.DO_NOT_TRACK = ""
      const afterOptOut = shouldDisableTelemetry({ consentEnabled: true, env, productEnvPrefix: "OMO_SENPI" })

      // then
      expect([beforeOptOut, duringOptOut, afterOptOut]).toEqual([false, true, false])
    })
  })
})
