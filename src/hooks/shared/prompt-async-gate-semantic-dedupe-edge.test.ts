import { describe, expect, test } from "bun:test"

import { createSemanticPromptDedupeKey } from "../../shared/prompt-async-gate/semantic-dedupe"

describe("semantic prompt dedupe key", () => {
  test("#given cyclic prompt inputs #when dedupe keys are created #then equivalent cycles are stable and do not throw", () => {
    // given
    const firstPrompt: Record<string, unknown> = {
      body: { parts: [{ type: "text", text: "continue" }] },
      path: { id: "ses_cycle" },
    }
    firstPrompt.self = firstPrompt

    const secondPrompt: Record<string, unknown> = {
      path: { id: "ses_cycle" },
      self: undefined,
      body: { parts: [{ text: "continue", type: "text" }] },
    }
    secondPrompt.self = secondPrompt

    // when
    const firstKey = createSemanticPromptDedupeKey(firstPrompt)
    const secondKey = createSemanticPromptDedupeKey(secondPrompt)

    // then
    expect(firstKey).toBe(secondKey)
  })
})
