export const VOICE_INTENT_SENTINEL = "[[voice-intent:1]]"

export const VOICE_INTENT_SENTINEL_REGEX = /\[\[voice-intent:1\]\]\s*/

export function detectAndStripVoiceIntent(text: string): {
  hasIntent: boolean
  text: string
} {
  const match = text.match(VOICE_INTENT_SENTINEL_REGEX)
  if (!match || match.index === undefined) {
    return { hasIntent: false, text }
  }
  const before = text.slice(0, match.index)
  const after = text.slice(match.index + match[0].length)
  return { hasIntent: true, text: `${before}${after}` }
}
