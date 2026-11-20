import { describe, expect, test } from "bun:test"

import { getBuiltInRequirementModelIDs } from "./model-capability-guardrails"
import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

describe("GPT-6 family routing", () => {
  test("quick leads with gpt-6-luna-fast low", () => {
    expect(CATEGORY_MODEL_REQUIREMENTS["quick"].fallbackChain[0]).toEqual({
      providers: ["openai", "chatgpt-subscription"],
      model: "gpt-6-luna-fast",
      variant: "low",
    })
  })

  test.each(["explore", "librarian"])("%s carries gpt-6-luna-fast low as its OpenAI rung", (agentName) => {
    const chain = AGENT_MODEL_REQUIREMENTS[agentName].fallbackChain
    expect(chain[1]).toEqual({
      providers: ["openai", "chatgpt-subscription"],
      model: "gpt-6-luna-fast",
      variant: "low",
    })
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
  ] as const)("%s follows Fable 5.2 and 5.1 with claude-opus-5-5 max", (name, table) => {
    const chain = table[name].fallbackChain
    const fableLead = ["claude-fable-5-2", "claude-fable-5-1"]
    expect(chain.slice(0, fableLead.length).map((rung) => rung.model)).toEqual(fableLead)
    expect(chain[fableLead.length]).toMatchObject({ model: "claude-opus-5-5", variant: "max" })
    for (const rung of chain.slice(1, fableLead.length + 1)) expect(rung.providers).toEqual(chain[0]?.providers)
  })
})
