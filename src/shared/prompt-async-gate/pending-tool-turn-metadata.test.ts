/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { latestAssistantTurnBlocksInternalPrompt } from "./pending-tool-turn"

describe("latestAssistantTurnBlocksInternalPrompt metadata-only messages", () => {
  test("#given empty unknown assistant turn has no parts loaded #when checking prompt safety #then internal prompts stay blocked", () => {
    // given
    const messages = [
      {
        info: {
          role: "user",
          time: { created: 1000 },
        },
      },
      {
        info: {
          role: "assistant",
          finish: "unknown",
          time: { created: 2000, completed: 3000 },
        },
      },
    ]

    // when
    const blocks = latestAssistantTurnBlocksInternalPrompt(messages)

    // then
    expect(blocks).toBe(true)
  })

  test("#given completed tool-calls assistant turn has no parts loaded #when checking prompt safety #then internal prompts stay blocked", () => {
    // given
    const messages = [
      {
        info: {
          role: "user",
          time: { created: 1000 },
        },
      },
      {
        info: {
          role: "assistant",
          finish: "tool-calls",
          time: { created: 2000, completed: 3000 },
        },
      },
    ]

    // when
    const blocks = latestAssistantTurnBlocksInternalPrompt(messages)

    // then
    expect(blocks).toBe(true)
  })
})
