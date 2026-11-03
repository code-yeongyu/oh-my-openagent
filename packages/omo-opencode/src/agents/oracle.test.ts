import { describe, expect, test } from "bun:test"

import { createOracleAgent } from "./oracle"

describe("createOracleAgent", () => {
  test("uses high reasoning effort for gpt-5.6", () => {
    // given
    const model = "openai/gpt-5.6-sol"

    // when
    const agent = createOracleAgent(model)

    // then
    expect(agent.reasoningEffort).toBe("high")
  })

  test("uses high reasoning effort for GPT-6 Astra frontier routing", () => {
    expect(createOracleAgent("github-copilot/gpt-6-astra").reasoningEffort).toBe("high")
  })

  test("preserves high reasoning effort for gpt-5.5 fallback", () => {
    // given
    const model = "openai/gpt-5.5"

    // when
    const agent = createOracleAgent(model)

    // then
    expect(agent.reasoningEffort).toBe("high")
  })
})
