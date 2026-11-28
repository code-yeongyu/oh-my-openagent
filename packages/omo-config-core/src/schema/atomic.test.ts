import { describe, expect, test } from "bun:test"

import {
  OmoAtomicSettingsLayerSchema,
  OmoAtomicSettingsSchema,
  OmoConfigLayerSchema,
  OmoConfigProfileSchema,
  OmoConfigSchema,
  OmoTypedHarnessConfigSchema,
  resolveOmoAtomicSettings,
  type OmoAtomicSettings,
} from "../index"

const DEFAULT_ATOMIC_SETTINGS: OmoAtomicSettings = {
  enabled: false,
  context: { enabled: true, limit: 5, budget_chars: 8000, timeout_ms: 1000, cache_ttl_ms: 15_000 },
  recording: { enabled: true, owner: "auto", timeout_ms: 30_000 },
}

describe("atomic settings schema", () => {
  test("#given an empty atomic block #when parsed with the resolved schema #then every nested default applies", () => {
    // given
    const block = {}

    // when
    const parsed = OmoAtomicSettingsSchema.parse(block)

    // then
    expect(parsed).toEqual(DEFAULT_ATOMIC_SETTINGS)
    expect(resolveOmoAtomicSettings({})).toEqual(DEFAULT_ATOMIC_SETTINGS)
  })

  test("#given a partial atomic block #when parsed with the layer schema #then no default is injected", () => {
    // given
    const block = { context: { limit: 3 } }

    // when
    const parsed = OmoAtomicSettingsLayerSchema.parse(block)

    // then
    expect(parsed).toEqual({ context: { limit: 3 } })
  })

  test.each([["isolation"], ["displacement"], ["experimental"], ["unknown_switch"]])(
    "#given atomic.%s #when parsed #then strict validation rejects the key",
    (key) => {
      // given
      const block = { enabled: true, [key]: { enabled: true } }

      // when
      const layer = OmoAtomicSettingsLayerSchema.safeParse(block)
      const resolved = OmoAtomicSettingsSchema.safeParse(block)

      // then
      expect(layer.success).toBe(false)
      expect(resolved.success).toBe(false)
    },
  )

  test.each([
    [{ context: { unknown_switch: true } }],
    [{ recording: { unknown_switch: true } }],
    [{ context: { limit: 0 } }],
    [{ context: { limit: 21 } }],
    [{ context: { budget_chars: 255 } }],
    [{ context: { timeout_ms: 5001 } }],
    [{ context: { cache_ttl_ms: -1 } }],
    [{ recording: { owner: "nobody" } }],
    [{ recording: { timeout_ms: 999 } }],
    [{ binary_path: "" }],
    [{ binary_path: "bin/atomic" }],
  ])("#given the invalid block %j #when parsed #then both schemas reject it", (block) => {
    // when
    const layer = OmoAtomicSettingsLayerSchema.safeParse(block)
    const resolved = OmoAtomicSettingsSchema.safeParse(block)

    // then
    expect(layer.success).toBe(false)
    expect(resolved.success).toBe(false)
  })

  test.each([["/usr/local/bin/atomic"], ["C:\\Tools\\atomic.exe"]])(
    "#given the absolute binary_path %s #when parsed #then it is accepted",
    (binaryPath) => {
      expect(OmoAtomicSettingsLayerSchema.parse({ binary_path: binaryPath })).toEqual({ binary_path: binaryPath })
    },
  )

  test("#given atomic on every config surface #when parsed #then each surface accepts it and only the root applies defaults", () => {
    // given
    const block = { enabled: true, context: { limit: 2 } }

    // when
    const typedHarness = OmoTypedHarnessConfigSchema.parse({ atomic: block })
    const profile = OmoConfigProfileSchema.parse({ atomic: block, "[native]": { atomic: block } })
    const layer = OmoConfigLayerSchema.parse({ atomic: block, profiles: { p: { atomic: block } } })
    const root = OmoConfigSchema.parse({ atomic: block })

    // then
    expect(typedHarness.atomic).toEqual(block)
    expect(profile.atomic).toEqual(block)
    expect(profile["[native]"]?.atomic).toEqual(block)
    expect(layer.atomic).toEqual(block)
    expect(layer.profiles?.["p"]?.atomic).toEqual(block)
    expect(root.atomic).toEqual({
      ...DEFAULT_ATOMIC_SETTINGS,
      enabled: true,
      context: { ...DEFAULT_ATOMIC_SETTINGS.context, limit: 2 },
    })
    expect(OmoConfigSchema.parse({}).atomic).toBeUndefined()
  })

  test("#given atomic.isolation on a layer surface #when parsed #then the layer is rejected", () => {
    expect(OmoConfigLayerSchema.safeParse({ atomic: { isolation: { enabled: true } } }).success).toBe(false)
    expect(OmoTypedHarnessConfigSchema.safeParse({ atomic: { experimental: {} } }).success).toBe(false)
  })
})
