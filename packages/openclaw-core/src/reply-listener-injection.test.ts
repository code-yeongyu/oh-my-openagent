import { describe, expect, test } from "bun:test"
import { sanitizeReplyInput } from "./reply-listener-injection"

describe("sanitizeReplyInput", () => {
  test("removes terminal control characters before tmux injection", () => {
    // given C0 controls that are stripped before newline handling plus DEL
    const strippedControls = Array.from({ length: 0x20 }, (_value, code) => code)
      .filter((code) => code <= 0x08 || code === 0x0b || code === 0x0c || code >= 0x0e)
      .map((code) => String.fromCharCode(code))
      .join("")
    const input = `a${strippedControls}${String.fromCharCode(0x7f)}b`

    // when sanitizing the reply text
    const result = sanitizeReplyInput(input)

    // then the terminal control characters are removed
    expect(result).toBe("ab")
  })

  test("removes bidi and zero-width format controls", () => {
    // given bidi and zero-width code points stripped by the sanitizer
    const formatControls = [
      0x200e,
      0x200f,
      0x202a,
      0x202b,
      0x202c,
      0x202d,
      0x202e,
      0x2066,
      0x2067,
      0x2068,
      0x2069,
    ]
      .map((code) => String.fromCharCode(code))
      .join("")
    const input = `a${formatControls}b`

    // when sanitizing the reply text
    const result = sanitizeReplyInput(input)

    // then the bidi and zero-width format controls are removed
    expect(result).toBe("ab")
  })

  test("collapses CRLF and LF into spaces", () => {
    // given reply text with CRLF and LF line breaks
    const input = "a\r\nb\nc"

    // when sanitizing the reply text
    const result = sanitizeReplyInput(input)

    // then each line break becomes one space
    expect(result).toBe("a b c")
  })

  test("escapes shell-sensitive sequences before send-keys", () => {
    // given reply text containing shell-sensitive characters and command starts
    const input = "backslash \\ backtick ` command $( interpolation ${"

    // when sanitizing the reply text
    const result = sanitizeReplyInput(input)

    // then each sensitive sequence is escaped in the current replacement order
    expect(result).toBe("backslash \\\\ backtick \\` command \\$( interpolation \\${")
  })

  test("trims surrounding whitespace while preserving ordinary text", () => {
    // given ordinary reply text with surrounding whitespace
    const input = "  Plain reply with tab\tinside  "

    // when sanitizing the reply text
    const result = sanitizeReplyInput(input)

    // then surrounding whitespace is trimmed and ordinary text is preserved
    expect(result).toBe("Plain reply with tab\tinside")
  })

  test("leaves normal reply text untouched", () => {
    // given ordinary reply text with no characters requiring sanitization
    const input = "Plain reply: hello world"

    // when sanitizing the reply text
    const result = sanitizeReplyInput(input)

    // then the reply text is unchanged
    expect(result).toBe(input)
  })
})
