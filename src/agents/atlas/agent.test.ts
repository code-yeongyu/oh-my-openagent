import { describe, expect, test } from "bun:test"
import { getDefaultAtlasPrompt } from "./default"
import { getGptAtlasPrompt } from "./gpt"
import { getGeminiAtlasPrompt } from "./gemini"
import { buildDecisionMatrix } from "./prompt-section-builder"
import type { AvailableAgent } from "../dynamic-agent-prompt-builder"

describe("atlas prompt contract", () => {
  const prompts = [
    ["default", getDefaultAtlasPrompt()],
    ["gpt", getGptAtlasPrompt()],
    ["gemini", getGeminiAtlasPrompt()],
  ] as const

  test.each(prompts)("%s prompt prefers planner metadata and limits plan edits", (_name, prompt) => {
    expect(prompt).toContain("DEFAULT execution contract")
    expect(prompt).toContain("Atlas may update checkbox/status markers ONLY after verification")
    expect(prompt).toContain("Atlas MUST NOT rewrite task wording")
  })

  test("decision matrix is marked as fallback guidance", () => {
    const agents: AvailableAgent[] = [{
      name: "oracle",
      description: "Architecture review expert",
      metadata: {
        category: "advisor",
        cost: "EXPENSIVE",
        triggers: [],
      },
    }]
    const matrix = buildDecisionMatrix(agents)

    expect(matrix).toContain("##### Fallback Decision Matrix")
    expect(matrix).toContain("ONLY when the current task block does not already specify category / skills metadata")
  })
})
