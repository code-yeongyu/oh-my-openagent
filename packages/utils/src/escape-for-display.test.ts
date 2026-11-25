import { describe, expect, test } from "bun:test"
import { escapeForDisplay, hasControlCharacter } from "./escape-for-display"
import { DISPLAY_UNSAFE, ORDINARY, unsafeCodeUnits } from "./testing/display-unsafe"

// #13304: text that another device sent is shown with every control, format and separator character escaped, so it
// cannot forge a line, hide text or reverse the rest of the line.
describe("escapeForDisplay", () => {
  test("#given a right-to-left override, a newline and an ESC sequence #then none is left raw and each shows its escape", () => {
    const shown = escapeForDisplay("evil\u202Ename\nnext line\u001b[31m")
    expect(/[\u202E\n\u001b]/u.test(shown)).toBe(false)
    expect(shown).toBe(String.raw`evil\u202ename\u000anext line\u001b[31m`)
  })

  test.each([
    ["a line separator", "a\u2028b", String.raw`a\u2028b`],
    ["a paragraph separator", "a\u2029b", String.raw`a\u2029b`],
    ["a zero-width space", "a\u200Bb", String.raw`a\u200bb`],
    ["a tag character above the basic plane", "a\u{E0041}b", String.raw`a\u{e0041}b`],
  ] as const)("#given %s #then it is escaped", (_label, text, expected) => {
    expect(escapeForDisplay(text)).toBe(expected)
  })

  test.each([
    ["a plain code", "session_gone"],
    ["Korean text", "세션을 깨울 수 없습니다"],
    ["an emoji", "\u{1F600}"],
    ["an accent written as a combining mark", "e\u0301"],
  ] as const)("#given %s #then it is shown unchanged", (_label, text) => {
    expect(escapeForDisplay(text)).toBe(text)
  })

  test("#given every display fixture #when escaped #then no listed code unit is left and the visible text around it stays", () => {
    for (const fixture of DISPLAY_UNSAFE) {
      const shown = escapeForDisplay(fixture)
      expect({ fixture, units: unsafeCodeUnits(shown) }).toEqual({ fixture, units: [] })
      expect(shown.startsWith("a") && shown.endsWith("b")).toBe(true)
    }
  })

  test("#given every display fixture #when escaped keeping line feeds #then only the line feed stays raw", () => {
    for (const fixture of DISPLAY_UNSAFE) {
      const shown = escapeForDisplay(fixture, { keepLineFeeds: true })
      expect({ fixture, units: unsafeCodeUnits(shown, { keepLineFeeds: true }) }).toEqual({ fixture, units: [] })
    }
    expect(escapeForDisplay("one\ntwo\r\nthree", { keepLineFeeds: true })).toBe(
      String.raw`one` + "\n" + String.raw`two\u000d` + "\n" + "three",
    )
    expect(escapeForDisplay("one\ntwo")).toBe(String.raw`one\u000atwo`)
  })

  test("#given lone surrogates and a joined pair #when escaped #then each lone half is escaped and the pair is kept", () => {
    expect(escapeForDisplay("a\ud800b\udc00c")).toBe(String.raw`a\ud800b\udc00c`)
    expect(escapeForDisplay("\ud83d\ude00")).toBe("\u{1F600}")
  })

  test("#given the zero-width joiner #when escaped #then it is still escaped", () => {
    expect(escapeForDisplay("a\u200db")).toBe(String.raw`a\u200db`)
  })

  test("#given ordinary text #when escaped either way #then it is unchanged", () => {
    for (const text of ORDINARY) {
      expect(escapeForDisplay(text)).toBe(text)
      expect(escapeForDisplay(text, { keepLineFeeds: true })).toBe(text)
    }
  })
})

describe("hasControlCharacter", () => {
  test("#given each control character (C0, DEL, C1) #when checked twice in a row #then both answers are true", () => {
    for (const text of ["a\u0000b", "a\tb", "a\nb", "a\rb", "a\u001b[31mb", "a\u007fb", "a\u009b2Jb"]) {
      expect({ text, first: hasControlCharacter(text), second: hasControlCharacter(text) }).toEqual({
        text,
        first: true,
        second: true,
      })
    }
  })

  test("#given format, separator and ordinary text #when checked #then the answer is false: those stay addressable (#13304)", () => {
    for (const text of [
      ...ORDINARY,
      "  plain words  ",
      "p\u202Eq r\u200Dt",
      "a\u2066b\u2069",
      "a\u2028b",
      "a\u{E0041}b",
    ])
      expect(hasControlCharacter(text)).toBe(false)
  })
})
