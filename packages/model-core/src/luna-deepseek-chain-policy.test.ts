import { describe, expect, test } from "bun:test"

import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"
import type { FallbackEntry } from "./model-requirement-types"

const LUNA_LOW = {
  providers: ["openai-codex"],
  model: "gpt-5.6-luna-fast",
  variant: "low",
} satisfies FallbackEntry

const DEEPSEEK_OFF = {
  providers: ["deepseek"],
  model: "deepseek-v4-flash",
  variant: "off",
} satisfies FallbackEntry

const DEEPSEEK_MAX = {
  providers: ["deepseek"],
  model: "deepseek-v4-flash",
  variant: "max",
} satisfies FallbackEntry

describe("Luna and DeepSeek chain policy", () => {
  test("quick places non-reasoning DeepSeek V4 Flash immediately after Luna", () => {
    const quick = CATEGORY_MODEL_REQUIREMENTS["quick"].fallbackChain

    expect(quick.slice(1, 3)).toEqual([LUNA_LOW, DEEPSEEK_OFF])
  })

  test.each(["explore", "librarian"])(
    "%s places max-reasoning DeepSeek V4 Flash immediately after Luna",
    (agentName) => {
      const chain = AGENT_MODEL_REQUIREMENTS[agentName].fallbackChain

      expect(chain.slice(0, 2)).toEqual([
        { providers: ["openai", "openai-codex"], model: "gpt-5.6-luna-fast", variant: "low" },
        DEEPSEEK_MAX,
      ])
    },
  )
})
