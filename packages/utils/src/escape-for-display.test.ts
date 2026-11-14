import { describe, expect, test } from "bun:test"
import { escapeForDisplay } from "./escape-for-display"

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
})
