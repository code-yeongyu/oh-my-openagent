import { describe, expect, test } from "bun:test"

import { OmoMemorySettingsSchema } from "./memory"

describe("OmoMemorySettingsSchema v2 block defaults", () => {
  test("#given nudge defaults #when parsing empty #then nudge is enabled with every_user_turns 10", () => {
    // given
    const input = {}

    // when
    const parsed = OmoMemorySettingsSchema.parse(input)

    // then
    expect(parsed.nudge).toEqual({ enabled: true, every_user_turns: 10 })
  })

  test("#given nudge every_user_turns below 1 #when parsed #then validation fails", () => {
    // given
    const input = { nudge: { every_user_turns: 0 } }

    // when
    const result = OmoMemorySettingsSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
  })

  test("#given facts defaults #when parsing empty #then facts is enabled with debounce_settles 4", () => {
    // given
    const input = {}

    // when
    const parsed = OmoMemorySettingsSchema.parse(input)

    // then
    expect(parsed.facts).toEqual({ enabled: true, debounce_settles: 4 })
  })

  test("#given facts with a category field #when parsed #then the strict schema rejects it", () => {
    // given
    const input = { facts: { category: "quick" } }

    // when
    const result = OmoMemorySettingsSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
  })

  test("#given facts debounce_settles below 1 #when parsed #then validation fails", () => {
    // given
    const input = { facts: { debounce_settles: 0 } }

    // when
    const result = OmoMemorySettingsSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
  })

  test("#given dream defaults #when parsing empty #then dream is fully populated", () => {
    // given
    const input = {}

    // when
    const parsed = OmoMemorySettingsSchema.parse(input)

    // then
    expect(parsed.dream).toEqual({
      enabled: true,
      idle_minutes: 30,
      min_hours_between: 24,
      shutdown_launch: true,
      auto_select_max: 5,
      auto_select_max_chars: 150000,
    })
  })

  test("#given dream idle_minutes 0 #when parsed #then 0 is allowed (disables idle trigger)", () => {
    // given
    const input = { dream: { idle_minutes: 0 } }

    // when
    const parsed = OmoMemorySettingsSchema.parse(input)

    // then
    expect(parsed.dream.idle_minutes).toBe(0)
  })

  test("#given dream min_hours_between below 1 #when parsed #then validation fails", () => {
    // given
    const input = { dream: { min_hours_between: 0 } }

    // when
    const result = OmoMemorySettingsSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
  })

  test("#given dream auto_select_max outside 1..10 #when parsed #then validation fails", () => {
    // given
    const tooLow = { dream: { auto_select_max: 0 } }
    const tooHigh = { dream: { auto_select_max: 11 } }

    // when
    const lowResult = OmoMemorySettingsSchema.safeParse(tooLow)
    const highResult = OmoMemorySettingsSchema.safeParse(tooHigh)

    // then
    expect(lowResult.success).toBe(false)
    expect(highResult.success).toBe(false)
  })

  test("#given dream auto_select_max_chars below 10000 #when parsed #then validation fails", () => {
    // given
    const input = { dream: { auto_select_max_chars: 9999 } }

    // when
    const result = OmoMemorySettingsSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
  })

  test("#given people defaults #when parsing empty #then people is enabled with limits", () => {
    // given
    const input = {}

    // when
    const parsed = OmoMemorySettingsSchema.parse(input)

    // then
    expect(parsed.people).toEqual({ enabled: true, max_entries: 40, max_entry_chars: 200 })
  })

  test("#given people max_entries outside 1..100 #when parsed #then validation fails", () => {
    // given
    const tooLow = { people: { max_entries: 0 } }
    const tooHigh = { people: { max_entries: 101 } }

    // when
    const lowResult = OmoMemorySettingsSchema.safeParse(tooLow)
    const highResult = OmoMemorySettingsSchema.safeParse(tooHigh)

    // then
    expect(lowResult.success).toBe(false)
    expect(highResult.success).toBe(false)
  })

  test("#given people max_entry_chars outside 50..500 #when parsed #then validation fails", () => {
    // given
    const tooLow = { people: { max_entry_chars: 49 } }
    const tooHigh = { people: { max_entry_chars: 501 } }

    // when
    const lowResult = OmoMemorySettingsSchema.safeParse(tooLow)
    const highResult = OmoMemorySettingsSchema.safeParse(tooHigh)

    // then
    expect(lowResult.success).toBe(false)
    expect(highResult.success).toBe(false)
  })

  test("#given soul defaults #when parsing empty #then edit_notice is true", () => {
    // given
    const input = {}

    // when
    const parsed = OmoMemorySettingsSchema.parse(input)

    // then
    expect(parsed.soul).toEqual({ edit_notice: true })
  })

  test("#given soul with an unknown key #when parsed #then the strict schema rejects it", () => {
    // given
    const input = { soul: { bogus: true } }

    // when
    const result = OmoMemorySettingsSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
  })

  test("#given an unknown key inside any v2 block #when parsed #then the strict schema rejects it", () => {
    // given
    const cases = [
      { nudge: { bogus: true } },
      { facts: { bogus: true } },
      { dream: { bogus: true } },
      { people: { bogus: true } },
    ]

    // when
    const results = cases.map((input) => OmoMemorySettingsSchema.safeParse(input))

    // then
    for (const result of results) {
      expect(result.success).toBe(false)
    }
  })
})
