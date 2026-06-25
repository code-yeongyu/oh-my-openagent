import { describe, expect, test } from "bun:test"
import {
  VOICE_INTENT_SENTINEL,
  detectAndStripVoiceIntent,
} from "./voice-intent"

describe("voice-intent sentinel constants", () => {
  test("#given the exported sentinel literal #when read #then matches the cross-package single source of truth", () => {
    expect(VOICE_INTENT_SENTINEL).toBe("[[voice-intent:1]]")
  })
})

describe("detectAndStripVoiceIntent", () => {
  test("#given a prompt that begins with the sentinel #when stripped #then hasIntent is true and the leading sentinel plus trailing whitespace are removed", () => {
    const result = detectAndStripVoiceIntent("[[voice-intent:1]] ultrawork please")
    expect(result.hasIntent).toBe(true)
    expect(result.text).toBe("ultrawork please")
  })

  test("#given a prompt without the sentinel #when stripped #then hasIntent is false and text is unchanged", () => {
    const result = detectAndStripVoiceIntent("ultrawork please")
    expect(result.hasIntent).toBe(false)
    expect(result.text).toBe("ultrawork please")
  })

  test("#given a prompt with the sentinel after a system reminder block has been removed earlier #when stripped #then it still triggers detection", () => {
    const result = detectAndStripVoiceIntent("[[voice-intent:1]] team mode go")
    expect(result.hasIntent).toBe(true)
    expect(result.text).toBe("team mode go")
  })

  test("#given a prompt with the sentinel mid-string #when stripped #then it is still detected and removed", () => {
    const result = detectAndStripVoiceIntent("Ciao [[voice-intent:1]] tutto bene")
    expect(result.hasIntent).toBe(true)
    expect(result.text).toBe("Ciao tutto bene")
  })

  test("#given an empty string #when stripped #then hasIntent is false and text is empty", () => {
    const result = detectAndStripVoiceIntent("")
    expect(result.hasIntent).toBe(false)
    expect(result.text).toBe("")
  })

  test("#given the sentinel with multiple whitespace characters after it #when stripped #then all the whitespace adjacent to the sentinel is removed", () => {
    const result = detectAndStripVoiceIntent("[[voice-intent:1]]   ultrawork")
    expect(result.hasIntent).toBe(true)
    expect(result.text).toBe("ultrawork")
  })
})
