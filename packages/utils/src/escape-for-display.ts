// Mirrored in packages/omo-native/bin/lib/display-escape.js; packages/omo-native/test/display-escape-parity.test.ts fails if the two differ.

/**
 * Text shown to a person or a model that may carry characters able to change how a line reads: control characters
 * (Cc: a newline, an ESC sequence), format characters (Cf: direction overrides and isolates, zero-width and tag
 * characters), line or paragraph separators (Zl, Zp) and lone surrogates (Cs). Each is shown as an escape, \uXXXX, or
 * \u{XXXXX} above the basic plane; nothing is deleted, so the text keeps every character it had. Chosen by Unicode
 * category, not by ranges. `keepLineFeeds` leaves U+000A raw for multi-line message content; everything else in the
 * set, a carriage return included, is still escaped.
 */
const UNSAFE_FOR_DISPLAY = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu
// A typed reference (a thread address) refuses control characters only: format characters stay addressable, because a
// peer may name a thread with them and matching uses the raw data (#13304); where such text is shown it is escaped.
const CONTROL_CHARACTER = /\p{Cc}/u

export function escapeForDisplay(
  text: string,
  { keepLineFeeds = false }: { readonly keepLineFeeds?: boolean } = {},
): string {
  return text.replace(UNSAFE_FOR_DISPLAY, (character) => {
    if (keepLineFeeds && character === "\n") return character
    const code = character.codePointAt(0) ?? 0
    return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, "0")}`
  })
}

export function hasControlCharacter(text: string): boolean {
  return CONTROL_CHARACTER.test(text)
}
