import { describe, expect, test } from "bun:test"
import { privacyScan } from "./omo-native-telemetry-assertions.mjs"
import { redactEvents } from "./omo-native-telemetry-evidence.mjs"

const attribution = { surface: "cli", install_id: "a".repeat(64), $is_server: true }
const event = (properties) => ({ event: "daily_active", properties })

describe("telemetry shared attribution privacy", () => {
  test("#given documented shared attribution #when payloads are scanned #then they pass", () => {
    expect(() => privacyScan([event(attribution)], [])).not.toThrow()
  })
  test("#given an installation identifier #when evidence is redacted #then it cannot identify the installation", () => {
    expect(redactEvents([event(attribution)])[0].properties.install_id).toBe("<redacted-install-id>")
  })
  for (const properties of [
    { ...attribution, surface: "unknown" },
    { ...attribution, install_id: "not-a-hash" },
    { ...attribution, extra: "secret" },
    { ...attribution, $is_server: "unexpected" },
  ]) {
    test(`#given invalid attribution ${JSON.stringify(properties)} #when scanned #then it fails`, () => {
      expect(() => privacyScan([event(properties)], [])).toThrow()
    })
  }
})
