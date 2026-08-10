import { describe, expect, test } from "bun:test"

import { TELEMETRY_HARNESS_SUPPORT } from "./telemetry"

describe("telemetry harness applicability", () => {
  test("#given the telemetry enabled setting #when checking harness support #then senpi is explicitly supported", () => {
    // given
    const settingPath = "telemetry.enabled" as const

    // when
    const supportedHarnesses = TELEMETRY_HARNESS_SUPPORT[settingPath]

    // then
    expect(supportedHarnesses).toContain("senpi")
  })
})
