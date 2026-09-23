import { describe, expect, test } from "bun:test"

import { getBuiltInRequirementModelIDs } from "./model-capability-guardrails"
import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

const GPT_PROVIDERS = ["openai", "chatgpt-subscription", "github-copilot", "opencode"]

describe("GPT-6 family routing", () => {
  test("deep-low leads with gpt-6-sol-fast medium on the OpenAI lanes, then gpt-6-sol medium, and nothing after it", () => {
    expect(CATEGORY_MODEL_REQUIREMENTS["deep-low"].fallbackChain).toEqual([
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-6-sol-fast", variant: "medium" },
      { providers: GPT_PROVIDERS, model: "gpt-6-sol", variant: "medium" },
    ])
  })

  test("deep-high still carries only Astra, so neither deep lane borrows the other's model", () => {
    expect(CATEGORY_MODEL_REQUIREMENTS["deep-high"].fallbackChain.map(({ model }) => model)).toEqual(["gpt-6-astra"])
    expect(CATEGORY_MODEL_REQUIREMENTS["deep-low"].fallbackChain.map(({ model }) => model)).not.toContain("gpt-6-astra")
  })

  test("quick leads with gpt-6-luna-fast low", () => {
    expect(CATEGORY_MODEL_REQUIREMENTS["quick"].fallbackChain[0]).toEqual({
      providers: ["openai", "chatgpt-subscription"],
      model: "gpt-6-luna-fast",
      variant: "low",
    })
  })

  test.each(["explore", "librarian"])("%s carries gpt-6-luna-fast low as its OpenAI rung", (agentName) => {
    const chain = AGENT_MODEL_REQUIREMENTS[agentName].fallbackChain
    expect(chain[1]).toEqual({ providers: ["openai", "chatgpt-subscription"], model: "gpt-6-luna-fast", variant: "low" })
    expect(chain.map(({ model }) => model)).not.toContain("gpt-5.6-luna-fast")
  })

  test("no builtin chain names a GPT-5.6 Luna tier any more", () => {
    const ids = getBuiltInRequirementModelIDs()
    expect(ids).toContain("gpt-6-sol")
    expect(ids).toContain("gpt-6-luna-fast")
    expect(ids).not.toContain("gpt-5.6-luna-fast")
    expect(ids).not.toContain("gpt-5.6-luna")
  })

  test.each([
    ["artistry", CATEGORY_MODEL_REQUIREMENTS],
    ["prometheus", AGENT_MODEL_REQUIREMENTS],
  ] as const)("%s follows its Fable 5.1 lead with claude-opus-5-5 max", (name, table) => {
    const chain = table[name].fallbackChain
    expect(chain[0]?.model).toBe("claude-fable-5-1")
    expect(chain[1]).toMatchObject({ model: "claude-opus-5-5", variant: "max" })
    expect(chain[1]?.providers).toEqual(chain[0]?.providers)
  })
})
