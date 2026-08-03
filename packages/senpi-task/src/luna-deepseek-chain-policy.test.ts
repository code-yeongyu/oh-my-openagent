import { describe, expect, test } from "bun:test"
import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"

import { AGENT_FALLBACK_CHAINS } from "./agents/builtin/fallback-chains"
import { CATEGORY_FALLBACK_CHAINS } from "./category/fallback-chains"

const DEEPSEEK_OFF = {
  providers: ["deepseek"],
  model: "deepseek-v4-flash",
  variant: "off",
} satisfies DelegateFallbackEntry

const DEEPSEEK_MAX = {
  providers: ["deepseek"],
  model: "deepseek-v4-flash",
  variant: "max",
} satisfies DelegateFallbackEntry

describe("Senpi Luna and DeepSeek chain policy", () => {
  test("quick places non-reasoning DeepSeek V4 Flash immediately after Luna", () => {
    const quick = CATEGORY_FALLBACK_CHAINS["quick"]

    expect(quick?.slice(1, 3)).toEqual([
      { providers: ["quotio-openai"], model: "gpt-5.6-luna-fast", variant: "low" },
      DEEPSEEK_OFF,
    ])
  })

  test.each(["explore", "librarian"])(
    "%s places max-reasoning DeepSeek V4 Flash immediately after Luna",
    (agentName) => {
      const chain = AGENT_FALLBACK_CHAINS[agentName]

      expect(chain?.slice(0, 2)).toEqual([
        { providers: ["openai"], model: "gpt-5.6-luna-fast", variant: "low" },
        DEEPSEEK_MAX,
      ])
    },
  )
})
