export const VOICE_INTENT_SENTINEL = "[[voice-intent:1]]";

export const VOICE_INTENT_SENTINEL_REGEX = /^\[\[voice-intent:1\]\]\s*/;

export function prependVoiceIntent(text: string): string {
  if (VOICE_INTENT_SENTINEL_REGEX.test(text)) {
    return text;
  }
  return `${VOICE_INTENT_SENTINEL} ${text}`;
}

export function detectAndStripVoiceIntent(text: string): {
  hasIntent: boolean;
  text: string;
} {
  const match = text.match(VOICE_INTENT_SENTINEL_REGEX);
  if (!match) {
    return { hasIntent: false, text };
  }
  return { hasIntent: true, text: text.slice(match[0].length) };
}
