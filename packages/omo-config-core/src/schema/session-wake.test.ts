import { expect, test } from "bun:test"

import {
  OmoConfigLayerSchema,
  OmoConfigProfileSchema,
  OmoConfigSchema,
  OmoTypedHarnessConfigSchema,
  resolveSessionWakeSettings,
} from "../index"

// Config contract (#13037 design 5.3, A2.18; owner ruling 2026-11-14): waking a session that is not running needs no
// setting, so the same-device wake is on unless the configuration turns it off. The bound on unattended wakes
// (`wake_limit`) is gone (#14405): a send that met it left its message queued with nothing to deliver or report it.

test("#given no session_wake table #when the settings are resolved #then the same-device wake is on", () => {
  expect(resolveSessionWakeSettings(OmoConfigSchema.parse({}))).toEqual({ sameDevice: true })
})

test("#given an explicit same_device false #when the settings are resolved #then the same-device wake is off", () => {
  expect(resolveSessionWakeSettings(OmoConfigSchema.parse({ session_wake: { same_device: false } })).sameDevice).toBe(
    false,
  )
})

test("#given a session_wake table on every config layer #when it is parsed and resolved #then the value survives", () => {
  const session_wake = { same_device: false }
  for (const schema of [OmoConfigSchema, OmoConfigLayerSchema, OmoConfigProfileSchema, OmoTypedHarnessConfigSchema]) {
    expect(schema.parse({ session_wake }).session_wake).toEqual(session_wake)
  }
  expect(resolveSessionWakeSettings(OmoConfigSchema.parse({ session_wake }))).toEqual({ sameDevice: false })
})

test("#given the removed wake_limit or another unknown key #when it is parsed #then it is not a setting (the loader reports it as an unknown key and ignores it)", () => {
  for (const session_wake of [{ wake_limit: 3 }, { wake_limit: 0 }, { same_device: true, other: 1 }]) {
    expect(OmoConfigSchema.safeParse({ session_wake }).success).toBe(false)
  }
})
