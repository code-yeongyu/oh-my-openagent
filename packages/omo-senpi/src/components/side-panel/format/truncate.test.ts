import { describe, expect, test } from "bun:test"

import { padVisible, truncateVisible, truncateVisibleStart, visibleWidth } from "./truncate"

const PURPLE = "\x1b[38;2;203;166;247m"
const RESET = "\x1b[39m"

describe("visibleWidth", () => {
  test("#given styled text #when measured #then colour escapes do not count", () => {
    // given
    const text = `${PURPLE}USAGE${RESET}`

    // when
    const width = visibleWidth(text)

    // then
    expect(width).toBe(5)
  })
})

describe("padVisible", () => {
  test("#given styled text shorter than the column #when padded #then padding fills the printable gap", () => {
    // given
    const text = `${PURPLE}AB${RESET}`

    // when
    const padded = padVisible(text, 5)

    // then
    expect(padded).toBe(`${PURPLE}AB${RESET}   `)
  })

  test("#given text at or past the column #when padded #then it is returned untouched", () => {
    // given
    const text = "abcdef"

    // when
    const padded = padVisible(text, 4)

    // then
    expect(padded).toBe("abcdef")
  })
})

describe("truncateVisible", () => {
  test("#given text within the column #when truncated #then it is unchanged", () => {
    // given
    const text = "short"

    // when
    const cut = truncateVisible(text, 10)

    // then
    expect(cut).toBe("short")
  })

  test("#given long plain text #when truncated #then the head survives with an ellipsis", () => {
    // given
    const text = "abcdefghij"

    // when
    const cut = truncateVisible(text, 5)

    // then
    expect(cut).toBe("abcd…")
    expect(visibleWidth(cut)).toBe(5)
  })

  test("#given a cut inside a colour run #when truncated #then the colour is closed", () => {
    // given
    const text = `${PURPLE}abcdefghij${RESET}`

    // when
    const cut = truncateVisible(text, 5)

    // then
    expect(cut).toBe(`${PURPLE}abcd…${RESET}`)
    expect(visibleWidth(cut)).toBe(5)
  })

  test("#given a one-column budget #when truncated #then a single character is kept without an ellipsis", () => {
    // given
    const text = "abcdef"

    // when
    const cut = truncateVisible(text, 1)

    // then
    expect(visibleWidth(cut)).toBe(1)
    expect(cut).toBe("a")
  })
})

describe("truncateVisibleStart", () => {
  test("#given a long path #when truncated #then the tail survives", () => {
    // given
    const text = "/very/deep/nested/tree/project"

    // when
    const cut = truncateVisibleStart(text, 12)

    // then
    expect(cut).toBe("…ree/project")
    expect(visibleWidth(cut)).toBe(12)
  })

  test("#given styled text #when truncated from the start #then the result is plain and the right width", () => {
    // given
    const text = `${PURPLE}/a/b/c/d/e/f${RESET}`

    // when
    const cut = truncateVisibleStart(text, 6)

    // then
    expect(cut).toBe("…d/e/f")
    expect(visibleWidth(cut)).toBeLessThanOrEqual(6)
  })
})
