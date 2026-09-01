import { describe, expect, it } from "bun:test"

import { extractErrorMessage } from "./event"
import { resolveFallbackAgentName } from "./event-error-utils"

describe("event error utilities", () => {
  it("#given nested string error payload #when extracting message #then returns the nested provider message", () => {
    // given
    const error = { data: { error: "quota exhausted for model" }, message: "top-level wrapper" }

    // when
    const message = extractErrorMessage(error)

    // then
    expect(message).toBe("quota exhausted for model")
  })

  it("#given mixed-case GPT model error #when resolving fallback agent #then chooses hephaestus", () => {
    // given
    const sessionID = "ses_uppercase_gpt"

    // when
    const agentName = resolveFallbackAgentName({
      sessionID,
      mainSessionID: sessionID,
      message: "All credentials for model GPT-5.5 are cooling down",
    })

    // then
    expect(agentName).toBe("hephaestus")
  })
})
