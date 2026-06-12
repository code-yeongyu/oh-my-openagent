import { describe, expect, test } from "bun:test"
import { ULW_LOOP_TEMPLATE } from "./ralph-loop"

describe("ULW_LOOP_TEMPLATE", () => {
  test("returns the documented iteration caps for ultrawork and normal modes", () => {
    // given
    const expectedIterationCaps = "The iteration limit is 500 for ultrawork mode, 100 for normal mode"

    // when
    const template = ULW_LOOP_TEMPLATE

    // then
    expect(template).toContain(expectedIterationCaps)
  })
})
