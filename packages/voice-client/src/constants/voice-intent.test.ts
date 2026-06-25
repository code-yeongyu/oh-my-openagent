import { describe, expect, test } from "bun:test";
import {
  VOICE_INTENT_SENTINEL,
  VOICE_INTENT_SENTINEL_REGEX,
  detectAndStripVoiceIntent,
  prependVoiceIntent,
} from "./voice-intent.ts";

describe("voice-intent constants", () => {
  test("#given the exported sentinel constant #when read #then equals the documented literal", () => {
    expect(VOICE_INTENT_SENTINEL).toBe("[[voice-intent:1]]");
  });

  test("#given the regex #when matched against the sentinel followed by content #then it matches", () => {
    expect(VOICE_INTENT_SENTINEL_REGEX.test("[[voice-intent:1]] hello")).toBe(true);
  });

  test("#given the regex #when matched against plain text #then it does not match", () => {
    expect(VOICE_INTENT_SENTINEL_REGEX.test("plain text")).toBe(false);
  });
});

describe("prependVoiceIntent", () => {
  test("#given a plain prompt #when prepended #then output is sentinel + space + prompt", () => {
    expect(prependVoiceIntent("Ciao Claude")).toBe("[[voice-intent:1]] Ciao Claude");
  });

  test("#given a prompt that already carries the sentinel #when prepended again #then result is idempotent (no double prefix)", () => {
    const once = prependVoiceIntent("Ciao");
    const twice = prependVoiceIntent(once);
    expect(twice).toBe(once);
  });

  test("#given an empty string #when prepended #then output is just the sentinel + a single space", () => {
    expect(prependVoiceIntent("")).toBe("[[voice-intent:1]] ");
  });
});

describe("detectAndStripVoiceIntent", () => {
  test("#given prefixed text #when detected #then hasIntent is true and the leading sentinel is removed", () => {
    const result = detectAndStripVoiceIntent("[[voice-intent:1]] hello");
    expect(result.hasIntent).toBe(true);
    expect(result.text).toBe("hello");
  });

  test("#given plain text #when detected #then hasIntent is false and the text is unchanged", () => {
    const result = detectAndStripVoiceIntent("plain prompt");
    expect(result.hasIntent).toBe(false);
    expect(result.text).toBe("plain prompt");
  });

  test("#given a prefix followed by multiple whitespace characters #when detected #then all whitespace is stripped along with the sentinel", () => {
    const result = detectAndStripVoiceIntent("[[voice-intent:1]]   trimmed");
    expect(result.hasIntent).toBe(true);
    expect(result.text).toBe("trimmed");
  });
});
