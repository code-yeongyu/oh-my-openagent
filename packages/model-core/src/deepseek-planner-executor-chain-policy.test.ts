import { describe, expect, test } from "bun:test"

import { AGENT_MODEL_REQUIREMENTS } from "./model-requirements"
import type { FallbackEntry } from "./model-requirement-types"

const DEEPSEEK_V4_PRO_MAX = {
  providers: ["deepseek", "opencode-go", "vercel"],
  model: "deepseek-v4-pro",
  variant: "max",
} satisfies FallbackEntry

const DEEPSEEK_V4_FLASH_MAX = {
  providers: ["deepseek"],
  model: "deepseek-v4-flash",
  variant: "max",
} satisfies FallbackEntry

describe("DeepSeek planner-executor chain policy", () => {
  test("sisyphus places max-reasoning DeepSeek V4 Pro immediately after Kimi K3", () => {
    // given
    const chain = AGENT_MODEL_REQUIREMENTS["sisyphus"].fallbackChain

    // when
    const [primary, second, deepseekPro] = chain

    // then
    expect(primary?.model).toBe("claude-opus-5")
    expect(second?.model).toBe("kimi-k3")
    expect(deepseekPro).toEqual(DEEPSEEK_V4_PRO_MAX)
  })

  test("sisyphus-junior places max-reasoning DeepSeek V4 Flash immediately after Kimi K3", () => {
    // given
    const chain = AGENT_MODEL_REQUIREMENTS["sisyphus-junior"].fallbackChain

    // when
    const [primary, second, deepseekFlash] = chain

    // then
    expect(primary?.model).toBe("claude-sonnet-5")
    expect(second?.model).toBe("kimi-k3")
    expect(deepseekFlash).toEqual(DEEPSEEK_V4_FLASH_MAX)
  })

  test("planner and executor roles stay on distinct DeepSeek V4 tiers", () => {
    // given
    const plannerModels = AGENT_MODEL_REQUIREMENTS["sisyphus"].fallbackChain.map((entry) => entry.model)
    const executorModels = AGENT_MODEL_REQUIREMENTS["sisyphus-junior"].fallbackChain.map((entry) => entry.model)

    // when / then
    expect(plannerModels).toContain("deepseek-v4-pro")
    expect(plannerModels).not.toContain("deepseek-v4-flash")
    expect(executorModels).toContain("deepseek-v4-flash")
    expect(executorModels).not.toContain("deepseek-v4-pro")
  })
})
