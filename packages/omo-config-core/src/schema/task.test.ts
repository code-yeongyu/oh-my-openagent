import { describe, expect, test } from "bun:test"

import { OmoTaskSettingsSchema, type OmoTaskSettings } from "./task"

describe("OmoTaskSettingsSchema warnings", () => {
  test("#given no warning suppression override #when task settings parse #then unavailable categories warnings default on", () => {
    // given
    const input = {}

    // when
    const parsed: OmoTaskSettings = OmoTaskSettingsSchema.parse(input)

    // then
    expect(parsed.warnings?.unavailable_categories).toBe(true)
  })

  test("#given an explicit warning suppression override #when task settings parse #then the false override is preserved", () => {
    // given
    const input = { warnings: { unavailable_categories: false } }

    // when
    const parsed = OmoTaskSettingsSchema.parse(input)

    // then
    expect(parsed.warnings?.unavailable_categories).toBe(false)
  })

  test("#given a non-boolean warning suppression override #when task settings parse #then validation fails at the nested path", () => {
    // given
    const input = { warnings: { unavailable_categories: "nope" } }

    // when
    const result = OmoTaskSettingsSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected task settings parsing to fail")
    expect(result.error.issues.map((issue) => issue.path.join(".")).join(",")).toContain("warnings.unavailable_categories")
  })
})

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
