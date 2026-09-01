import { describe, expect, test } from "bun:test"

import { createOracleAgent } from "./oracle"

describe("createOracleAgent", () => {
  test("uses xhigh reasoning effort for gpt-5.6", () => {
    // given
    const model = "openai/gpt-5.6-sol"

    // when
    const agent = createOracleAgent(model)

    // then
    expect(agent.reasoningEffort).toBe("xhigh")
  })

  test("preserves medium reasoning effort for gpt-5.5 fallback", () => {
    // given
    const model = "openai/gpt-5.5"

    // when
    const agent = createOracleAgent(model)

    // then
    expect(agent.reasoningEffort).toBe("medium")
  })
})
