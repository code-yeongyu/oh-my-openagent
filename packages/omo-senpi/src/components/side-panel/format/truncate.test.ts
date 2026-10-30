import { describe, expect, test } from "bun:test"

import { padVisible, wrapVisible, truncateVisible, truncateVisibleStart, visibleWidth } from "./truncate"

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

  test("#given wide and surrogate-pair glyphs #when measured #then terminal cells are counted", () => {
    // given / when / then
    expect(visibleWidth("A界🙂")).toBe(5)
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

  test("#given wide glyphs #when truncated #then no glyph is split or allowed to overflow", () => {
    // given
    const text = "ab界🙂cd"

    // when
    const cut = truncateVisible(text, 5)

    // then
    expect(cut).toBe("ab界…")
    expect(visibleWidth(cut)).toBe(5)
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

  test("#given a wide tail #when truncated from the start #then complete glyphs fill the budget", () => {
    // given / when
    const cut = truncateVisibleStart("prefix界🙂", 5)

    // then
    expect(cut).toBe("…界🙂")
    expect(visibleWidth(cut)).toBe(5)
  })
})

describe("wrapVisible", () => {
  test("#given text shorter than the column #when wrapped #then it stays one row", () => {
    // given / when / then
    expect(wrapVisible("short enough", 40)).toEqual(["short enough"])
  })

  test("#given a long sentence #when wrapped #then every row fits and no word is broken", () => {
    // given an objective is prose, and prose read mid-word is worse than prose read short
    const rows = wrapVisible("Extend the side panel with the subsystems omo gained since beta 53", 20)

    // then
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.every((row) => visibleWidth(row) <= 20)).toBe(true)
    expect(rows.join(" ")).toBe("Extend the side panel with the subsystems omo gained since beta 53")
  })

  test("#given a single separator at the wrap point #when wrapped #then joining rows does not duplicate it", () => {
    // given
    const text = "Extend the side panel with the subsystems omo gained since beta.53"

    // when
    const rows = wrapVisible(text, 44)

    // then
    expect(rows.join(" ")).toBe(text)
  })

  test("#given text that already has newlines #when wrapped #then they survive as rows", () => {
    // given objectives are written in paragraphs and the shape carries meaning
    expect(wrapVisible("first\nsecond", 40)).toEqual(["first", "second"])
  })

  test("#given indentation and repeated spaces #when wrapped #then every whitespace character survives", () => {
    // given
    const text = "  first  second\n   \n    indented"

    // when
    const rows = wrapVisible(text, 40)

    // then
    expect(rows.join("\n")).toBe(text)
    expect(rows.every((row) => visibleWidth(row) <= 40)).toBe(true)
  })

  test("#given a word wider than the column #when wrapped #then it is split rather than overflowing", () => {
    // given a path or a token can exceed the column on its own
    const rows = wrapVisible("/very/long/path/that/never/fits/in/the/column", 12)

    // then
    expect(rows.every((row) => visibleWidth(row) <= 12)).toBe(true)
    expect(rows.join("")).toBe("/very/long/path/that/never/fits/in/the/column")
  })

  test("#given wide text #when wrapped #then every row fits in terminal cells", () => {
    // given / when
    const rows = wrapVisible("界界界", 4)

    // then
    expect(rows).toEqual(["界界", "界"])
  })

  test("#given no room at all #when wrapped #then nothing is produced", () => {
    // given / when / then
    expect(wrapVisible("anything", 0)).toEqual([])
  })
})
