import { describe, expect, test } from "bun:test"

import { OmoTaskSettingsSchema, type OmoTaskSettings } from "./task"

describe("OmoTaskSettingsSchema reattach", () => {
  test(" w2reattach #given no reconcile override #when task settings parse #then reattach remains enabled by absence", () => {
    // given
    const input = {}

    // when
    const parsed: OmoTaskSettings = OmoTaskSettingsSchema.parse(input)

    // then
    expect(parsed.reattach_on_reconcile).toBeUndefined()
  })

  test(" w2reattach #given reattach is disabled #when task settings parse #then the false override is preserved", () => {
    // given
    const input = { reattach_on_reconcile: false }

    // when
    const parsed = OmoTaskSettingsSchema.parse(input)

    // then
    expect(parsed.reattach_on_reconcile).toBe(false)
  })
})

describe("OmoTaskSettingsSchema depth", () => {
  test("#given depth beyond shared cap #when task settings parse #then rejects it", () => {
    expect(OmoTaskSettingsSchema.safeParse({ max_depth: 3 }).success).toBe(false)
  })
})
