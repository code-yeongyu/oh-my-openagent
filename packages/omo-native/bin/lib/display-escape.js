// Mirrored in packages/utils/src/escape-for-display.ts; packages/omo-native/test/display-escape-parity.test.ts fails if the two differ.

const UNSAFE_FOR_DISPLAY = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu

export function escapeForDisplay(text, { keepLineFeeds = false } = {}) {
  return text.replace(UNSAFE_FOR_DISPLAY, (character) => {
    if (keepLineFeeds && character === "\n") return character
    const code = character.codePointAt(0) ?? 0
    return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, "0")}`
  })
}
