import { describe, expect, test } from "bun:test"

import { shouldDisableTelemetry } from "./index"

const OPT_OUT_CASES = [
  ["unset env enables telemetry", {}, false],
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
  ["invalid disable value", { OMO_CODEX_DISABLE_POSTHOG: "maybe" }, false],
] as const

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
