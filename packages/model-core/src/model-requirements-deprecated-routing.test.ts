import { describe, expect, test } from "bun:test"
import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

describe("deprecated OpenCode Zen model routing", () => {
  test("no deprecated Haiku or GPT nano fallback entry routes through opencode", () => {
    // given
    const deprecatedModels = new Set(["claude-haiku-4-5", "gpt-5.4-nano"])
    const allEntries = [
      ...Object.values(AGENT_MODEL_REQUIREMENTS),
      ...Object.values(CATEGORY_MODEL_REQUIREMENTS),
    ].flatMap((requirement) => requirement.fallbackChain)

    // when
    const deprecatedOpencodeEntries = allEntries.filter(
      (entry) => deprecatedModels.has(entry.model) && entry.providers.includes("opencode")
    )

    // then
    expect(deprecatedOpencodeEntries).toEqual([])
  })
})
