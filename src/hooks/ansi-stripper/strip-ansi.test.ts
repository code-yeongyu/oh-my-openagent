import { describe, it, expect } from "bun:test"

import { stripAnsi, containsAnsi } from "./strip-ansi"

describe("stripAnsi", () => {
  it("removes basic color codes", () => {
    // given
    const input = "\x1b[31mERROR\x1b[0m: something failed"

    // when
    const result = stripAnsi(input)

    // then
    expect(result).toBe("ERROR: something failed")
  })

  it("removes bold and underline codes", () => {
    // given
    const input = "\x1b[1mBold\x1b[22m \x1b[4mUnderline\x1b[24m"

    // when
    const result = stripAnsi(input)

    // then
    expect(result).toBe("Bold Underline")
  })

  it("removes 256-color codes", () => {
    // given
    const input = "\x1b[38;5;196mRed text\x1b[0m"

    // when
    const result = stripAnsi(input)

    // then
    expect(result).toBe("Red text")
  })

  it("removes RGB color codes", () => {
    // given
    const input = "\x1b[38;2;255;0;0mRed\x1b[0m"

    // when
    const result = stripAnsi(input)

    // then
    expect(result).toBe("Red")
  })

  it("returns plain text unchanged", () => {
    // given
    const input = "no ansi codes here"

    // when
    const result = stripAnsi(input)

    // then
    expect(result).toBe("no ansi codes here")
  })

  it("returns empty string unchanged", () => {
    // given / when
    const result = stripAnsi("")

    // then
    expect(result).toBe("")
  })

  it("handles multiple escape sequences in one line", () => {
    // given
    const input = "\x1b[32m✓\x1b[0m \x1b[2mtest passed\x1b[22m in \x1b[33m5ms\x1b[0m"

    // when
    const result = stripAnsi(input)

    // then
    expect(result).toBe("✓ test passed in 5ms")
  })

  it("strips cursor movement sequences", () => {
    // given
    const input = "\x1b[2Ahello\x1b[K"

    // when
    const result = stripAnsi(input)

    // then
    expect(result).toBe("hello")
  })
})

describe("containsAnsi", () => {
  it("returns true for text with ANSI codes", () => {
    expect(containsAnsi("\x1b[31mred\x1b[0m")).toBe(true)
  })

  it("returns false for plain text", () => {
    expect(containsAnsi("plain text")).toBe(false)
  })

  it("returns false for empty string", () => {
    expect(containsAnsi("")).toBe(false)
  })
})
