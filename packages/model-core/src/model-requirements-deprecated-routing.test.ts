import { SUPPORTED_MODELS, SUPPORTED_PROVIDERS } from "./registry";
import { describe, expect, test } from "bun:test"
import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

describe("deprecated OpenCode Zen model routing", () => {
  test("no deprecated Haiku or GPT nano fallback entry routes through opencode", () => {
    // given
    const deprecatedModels: Set<string> = new Set([SUPPORTED_MODELS.CLAUDE_HAIKU_4_5, SUPPORTED_MODELS.GPT_5_4_NANO])
    const allEntries = [
      ...Object.values(AGENT_MODEL_REQUIREMENTS),
      ...Object.values(CATEGORY_MODEL_REQUIREMENTS),
    ].flatMap((requirement) => requirement.fallbackChain)

    // when
    const deprecatedOpencodeEntries = allEntries.filter(
      (entry) => deprecatedModels.has(entry.model) && entry.providers.includes(SUPPORTED_PROVIDERS.OPENCODE)
    )

    // then
    expect(deprecatedOpencodeEntries).toEqual([])
  })
})
