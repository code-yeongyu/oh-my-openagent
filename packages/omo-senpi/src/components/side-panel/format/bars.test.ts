import { describe, expect, test } from "bun:test"

import { bar } from "./bars"

describe("bar", () => {
  test("#given an empty ratio #when rendered #then every cell is empty", () => {
    // given
    const ratio = 0

    // when
    const rendered = bar(ratio, 6)

    // then
    expect(rendered).toBe("░░░░░░")
  })

  test("#given a full ratio #when rendered #then every cell is filled", () => {
    // given
    const ratio = 1

    // when
    const rendered = bar(ratio, 6)

    // then
    expect(rendered).toBe("██████")
  })

  test("#given a ratio above one #when rendered #then it clamps instead of overflowing", () => {
    // given
    const ratio = 4.2

    // when
    const rendered = bar(ratio, 4)

    // then
    expect(rendered).toBe("████")
  })

  test("#given a half ratio #when rendered #then half the cells are filled", () => {
    // given
    const ratio = 0.5

    // when
    const rendered = bar(ratio, 8)

    // then
    expect(rendered).toBe("████░░░░")
  })

  test("#given a sub-cell ratio #when rendered #then a partial block carries it", () => {
    // given
    const ratio = 0.06

    // when
    const rendered = bar(ratio, 10)

    // then
    expect(rendered).toBe("▋░░░░░░░░░")
  })

  test("#given a ratio too small to round to a cell #when rendered #then a sliver still shows", () => {
    // given
    const ratio = 0.001

    // when
    const rendered = bar(ratio, 10)

    // then
    expect(rendered.startsWith("▏")).toBe(true)
    expect(rendered).toHaveLength(10)
  })

  test("#given a marker #when rendered #then it sits at its own position in the bar", () => {
    // given
    const ratio = 0.2

    // when
    const rendered = bar(ratio, 10, { marker: 0.5 })

    // then
    expect(rendered).toBe("██░░░┊░░░░")
  })

  test("#given a marker at the far end #when rendered #then it stays inside the bar", () => {
    // given
    const ratio = 1

    // when
    const rendered = bar(ratio, 5, { marker: 1 })

    // then
    expect(rendered).toBe("████┊")
  })

  test("#given no width #when rendered #then nothing is produced", () => {
    // given
    const width = 0

    // when
    const rendered = bar(0.5, width)

    // then
    expect(rendered).toBe("")
  })

  test("#given any ratio #when rendered #then the cell count always equals the width", () => {
    // given
    const ratios = [0, 0.01, 0.33, 0.5, 0.87, 1]

    // when
    const lengths = ratios.map((ratio) => [...bar(ratio, 11)].length)

    // then
    expect(lengths).toEqual([11, 11, 11, 11, 11, 11])
  })
})
