import { describe, expect, test } from "bun:test"
import { OhMyOpenCodeConfigSchema } from "./oh-my-opencode-config"

describe("provider_models config", () => {
  test("#given openai and anthropic pin sets #then they parse with agents and categories", () => {
    // given
    const config = {
      provider_models: {
        openai: {
          agents: { "sisyphus-junior": { model: "openai/gpt-6.1-sol", variant: "xhigh" } },
          categories: { quick: { model: "openai/gpt-6-luna-fast" } },
        },
        anthropic: { agents: { "multimodal-looker": { model: "anthropic/claude-opus-5-5" } } },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    expect(result.data?.provider_models?.openai?.agents?.["sisyphus-junior"]?.variant).toBe("xhigh")
  })

  test("#given a provider other than openai or anthropic #then it is rejected", () => {
    // given
    const config = { provider_models: { google: { agents: { oracle: { model: "google/gemini-3.1-pro" } } } } }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("#given a pin without a provider/model id #then it is rejected", () => {
    // given
    const config = { provider_models: { openai: { agents: { oracle: { model: "gpt-6.1-sol" } } } } }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })
})
