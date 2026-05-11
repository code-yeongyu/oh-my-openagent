import { describe, test, expect } from "bun:test"
import { generateFriendlySessionName, FRIENDLY_SESSION_NAME_COMBO_COUNT } from "./generate-name"
import { FRUITS, VEGETABLES } from "./word-lists"

describe("generateFriendlySessionName", () => {
  test("returns fruit-vegetable shape", () => {
    // given
    const random = () => 0

    // when
    const name = generateFriendlySessionName({ random })

    // then
    expect(name).toBe(`${FRUITS[0]}-${VEGETABLES[0]}`)
  })

  test("uses last fruit and vegetable when random returns ~1", () => {
    // given - just shy of 1.0 so Math.floor lands on the last index
    const random = () => 0.9999

    // when
    const name = generateFriendlySessionName({ random })

    // then
    expect(name).toBe(`${FRUITS[FRUITS.length - 1]}-${VEGETABLES[VEGETABLES.length - 1]}`)
  })

  test("appends suffix when provided", () => {
    // given
    const random = () => 0

    // when
    const name = generateFriendlySessionName({ random, suffix: 2 })

    // then
    expect(name).toBe(`${FRUITS[0]}-${VEGETABLES[0]}-2`)
  })

  test("default Math.random produces a fruit followed by a vegetable", () => {
    // given - no random override

    // when
    const name = generateFriendlySessionName()
    const [fruit, vegetable] = name.split("-")

    // then
    expect(FRUITS).toContain(fruit as (typeof FRUITS)[number])
    expect(VEGETABLES).toContain(vegetable as (typeof VEGETABLES)[number])
  })

  test("combo count matches list cardinalities", () => {
    // given - constants
    // when / then
    expect(FRIENDLY_SESSION_NAME_COMBO_COUNT).toBe(FRUITS.length * VEGETABLES.length)
    expect(FRIENDLY_SESSION_NAME_COMBO_COUNT).toBeGreaterThan(500)
  })
})
