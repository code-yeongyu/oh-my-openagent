import { describe, expect, test } from "bun:test"

import { OmoConfigSchema } from "./config"
import { COMPUTER_HARNESS_SUPPORT, OmoComputerSettingsSchema } from "./computer"

describe("computer settings schema", () => {
  test("#given the cursor off switch #when config is parsed #then false survives validation", () => {
    // given: the public config spelling requested by the owner.
    const config = { computer: { showCursor: false } }
    // when
    const parsed = OmoConfigSchema.parse(config)
    // then
    expect(parsed.computer).toEqual({ showCursor: false })
  })

  test("#given every computer key #when parsed #then the block round-trips unchanged", () => {
    // given
    const block = {
      enabled: true,
      display: "all",
      max_width: 1920,
      max_height: 1080,
      screenshot_max_bytes: 1_000_000,
      stop_hotkey: "ctrl+alt+shift+escape",
      allow_host_relay_only_stop: false,
      macos_canary: "off",
      audit_log: { enabled: false },
      screenshot_gc: { enabled: true, stale_ms: 0, scan_interval_ms: 60_000 },
      engine_path: "/opt/engine",
      cua_adapter: true,
    } as const

    // when
    const parsed = OmoComputerSettingsSchema.parse(block)

    // then
    expect(parsed).toEqual(block)
  })

  test("#given an unknown or camelCase key #when parsed #then the strict block rejects it", () => {
    // given
    const camelCase = { cuaAdapter: true }

    // when
    const result = OmoComputerSettingsSchema.safeParse(camelCase)

    // then
    expect(result.success).toBe(false)
  })

  test("#given a root config with a computer block #when parsed #then the block is kept", () => {
    // given
    const config = { computer: { enabled: false } }

    // when
    const parsed = OmoConfigSchema.parse(config)

    // then
    expect(parsed.computer).toEqual({ enabled: false })
  })

  test("#given every computer key #when checking harness support #then each is native-only", () => {
    // given
    const keys = Object.keys(OmoComputerSettingsSchema.shape)

    // when
    const supported = keys.map((key) => COMPUTER_HARNESS_SUPPORT[`computer.${key}` as keyof typeof COMPUTER_HARNESS_SUPPORT])

    // then
    expect(supported).toEqual(keys.map(() => ["native"]))
  })
})
