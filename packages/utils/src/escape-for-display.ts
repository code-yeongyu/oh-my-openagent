/**
 * Text shown to a person or a model that may carry characters able to change how a line reads: control characters
 * (Cc: a newline, an ESC sequence), format characters (Cf: direction overrides and isolates, zero-width and tag
 * characters) and line or paragraph separators (Zl, Zp). Each is shown as an escape, \uXXXX, or \u{XXXXX} above the
 * basic plane; nothing is deleted, so the text keeps every character it had. Chosen by Unicode category, not by ranges.
 */
const UNSAFE_FOR_DISPLAY = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

export function escapeForDisplay(text: string): string {
  return text.replace(UNSAFE_FOR_DISPLAY, (character) => {
    const code = character.codePointAt(0) ?? 0
    return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, "0")}`
  })
}
