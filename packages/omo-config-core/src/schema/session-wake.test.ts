import { expect, test } from "bun:test"

import {
  OmoConfigLayerSchema,
  OmoConfigProfileSchema,
  OmoConfigSchema,
  OmoTypedHarnessConfigSchema,
  resolveSessionWakeSettings,
} from "../index"

// Config contract (#13037 design 5.3, A2.18, A3.5.3; owner ruling 2026-11-14): waking a session that is not running needs no
// setting, so the same-device wake is on and the bound on woken turns is 0 (none) unless the configuration says otherwise.

test("#given no session_wake table #when the settings are resolved #then the same-device wake is on and the wake limit is 0", () => {
  expect(resolveSessionWakeSettings(OmoConfigSchema.parse({}))).toEqual({ sameDevice: true, wakeLimit: 0 })
})

test("#given a session_wake table that sets only the limit #when the settings are resolved #then the same-device wake stays on", () => {
  expect(resolveSessionWakeSettings(OmoConfigSchema.parse({ session_wake: { wake_limit: 3 } }))).toEqual({
    sameDevice: true,
    wakeLimit: 3,
  })
})

test("#given an explicit same_device false #when the settings are resolved #then the same-device wake is off", () => {
  expect(resolveSessionWakeSettings(OmoConfigSchema.parse({ session_wake: { same_device: false } })).sameDevice).toBe(
    false,
  )
})

test("#given a session_wake table on every config layer #when it is parsed and resolved #then both values survive", () => {
  const session_wake = { same_device: true, wake_limit: 2 }
  for (const schema of [OmoConfigSchema, OmoConfigLayerSchema, OmoConfigProfileSchema, OmoTypedHarnessConfigSchema]) {
    expect(schema.parse({ session_wake }).session_wake).toEqual(session_wake)
  }
  expect(resolveSessionWakeSettings(OmoConfigSchema.parse({ session_wake }))).toEqual({
    sameDevice: true,
    wakeLimit: 2,
  })
})

test("#given a negative or fractional limit or an unknown key #when it is parsed #then the config is refused", () => {
  for (const session_wake of [{ wake_limit: -1 }, { wake_limit: 1.5 }, { same_device: true, other: 1 }]) {
    expect(OmoConfigSchema.safeParse({ session_wake }).success).toBe(false)
  }
})
