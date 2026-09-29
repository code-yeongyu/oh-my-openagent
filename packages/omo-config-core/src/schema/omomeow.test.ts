import { describe, expect, test } from "bun:test"

import { OmoConfigLayerSchema, OmoConfigSchema, resolveOmoMeowSettings } from "../index"

describe("omo config omomeow section", () => {
  test("#given an empty omomeow section #when parsed #then the nudge is on every 30 minutes in English", () => {
    // given
    const config = { omomeow: {} }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.omomeow).toEqual({ language: "en", nudge: { enabled: true, interval_minutes: 30 } })
  })

  test("#given explicit nudge overrides #when parsed #then they are preserved and unset keys keep defaults", () => {
    // given
    const config = { omomeow: { language: "ko", nudge: { interval_minutes: 15 } } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.omomeow).toEqual({ language: "ko", nudge: { enabled: true, interval_minutes: 15 } })
  })

  test("#given an omomeow layer without values #when parsed as a layer #then no defaults are injected", () => {
    // given
    const config = { omomeow: { nudge: {} } }

    // when
    const result = OmoConfigLayerSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.omomeow).toEqual({ nudge: {} })
  })

  test.each([
    ["a zero interval", { nudge: { interval_minutes: 0 } }],
    ["a fractional interval", { nudge: { interval_minutes: 1.5 } }],
    ["an interval above one day", { nudge: { interval_minutes: 1441 } }],
    ["an unknown language", { language: "fr" }],
    ["an unknown nudge key", { nudge: { intervalMinutes: 30 } }],
  ])("#given %s #when parsed #then validation fails", (_label, omomeow) => {
    // given
    const config = { omomeow }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("#given omomeow inside a harness block #when parsed #then it is rejected because the skill scripts read top-level layers only", () => {
    // given
    const config = { "[native]": { omomeow: { nudge: { enabled: false } } } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("#given no omomeow section #when resolved #then the defaults apply", () => {
    // given
    const config = {}

    // when
    const settings = resolveOmoMeowSettings(config)

    // then
    expect(settings).toEqual({ language: "en", nudge: { enabled: true, interval_minutes: 30 } })
  })
})
