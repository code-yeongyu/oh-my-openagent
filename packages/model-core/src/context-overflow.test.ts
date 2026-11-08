import { describe, expect, test } from "bun:test"

import { isContextOverflowMessage } from "./context-overflow"

describe("isContextOverflowMessage", () => {
  test.each([
    "Your input exceeds the context window of this model",
    "prompt is too long: 213462 tokens > 200000 maximum",
    "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)",
    "This model's maximum prompt length is 131072 but the request contains 537812 tokens",
    "Please reduce the length of the messages or completion",
    "413 Request body too large",
    "Input length (265330) exceeds model's maximum context length (262144).",
  ])("recognizes provider overflow: %s", (message) => {
    expect(isContextOverflowMessage(message)).toBe(true)
  })

  test.each([
    "429: too many requests",
    "400: invalid request",
    "503: All providers are temporarily cooling down",
  ])("rejects non-overflow failure: %s", (message) => {
    expect(isContextOverflowMessage(message)).toBe(false)
  })
})
