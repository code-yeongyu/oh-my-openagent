import { describe, expect, test } from "bun:test"

import { OmoTelemetrySettingsLayerSchema, TELEMETRY_HARNESS_SUPPORT } from "./telemetry"

describe("telemetry harness applicability", () => {
  test("#given the telemetry enabled setting #when checking harness support #then the native harness is explicitly supported", () => {
    // given
    const settingPath = "telemetry.enabled" as const

    // when
    const supportedHarnesses = TELEMETRY_HARNESS_SUPPORT[settingPath]

    // then
    expect(supportedHarnesses).toContain("native")
  })
})

describe("telemetry.rawTurnSampleRate", () => {
  test.each([
    [0, true],
    [0.05, true],
    [1, true],
    [-0.1, false],
    [1.5, false],
    ["0.5", false],
  ])("#given rawTurnSampleRate %p #when a config layer is parsed #then it is accepted: %p", (rawTurnSampleRate, accepted) => {
    expect(OmoTelemetrySettingsLayerSchema.safeParse({ rawTurnSampleRate }).success).toBe(accepted)
  })
})
