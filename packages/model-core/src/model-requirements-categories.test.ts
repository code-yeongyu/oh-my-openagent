import { describe, expect, test } from "bun:test"
import { CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

describe("CATEGORY_MODEL_REQUIREMENTS", () => {
  test("writing only activates when one of its own chain models is available", () => {
    expect(CATEGORY_MODEL_REQUIREMENTS["writing"].requiresAnyModel).toBe(true)
  })

  test("ultrabrain routes GPT-6 Astra max before the existing Sol max fallbacks", () => {
    expect(CATEGORY_MODEL_REQUIREMENTS.ultrabrain.fallbackChain).toEqual([
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-6-astra", variant: "max" },
      { providers: ["github-copilot"], model: "gpt-6-astra", variant: "max" },
      { providers: ["openai", "chatgpt-subscription", "opencode"], model: "gpt-6-astra", variant: "max" },
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-5.6-sol", variant: "max" },
      { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "max" },
      { providers: ["openai", "chatgpt-subscription", "opencode"], model: "gpt-5.6-sol", variant: "max" },
    ])
  })

  test("ultrabrain keeps gpt-5.6-sol max on every fallback rung", () => {
    // given
    const requirement = CATEGORY_MODEL_REQUIREMENTS["ultrabrain"]

    // when
    const chain = requirement.fallbackChain.filter(({ model }) => model === "gpt-5.6-sol")

    // then
    expect(chain).toEqual([
      {
        providers: ["openai", "chatgpt-subscription"],
        model: "gpt-5.6-sol",
        variant: "max",
      },
      {
        providers: ["github-copilot"],
        model: "gpt-5.6-sol",
        variant: "max",
      },
      {
        providers: ["openai", "chatgpt-subscription", "opencode"],
        model: "gpt-5.6-sol",
        variant: "max",
      }
    ])
  })

  test("deep-high routes GPT-6 Astra xhigh only", () => {
    expect(CATEGORY_MODEL_REQUIREMENTS["deep-high"].fallbackChain).toEqual([
      { providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"], model: "gpt-6-astra", variant: "xhigh" },
    ])
  })

  test("deep-low leads with gpt-6-sol-fast medium on the OpenAI lanes, then gpt-6-sol medium, and carries no GPT-5.6 Sol rung", () => {
    // given
    const requirement = CATEGORY_MODEL_REQUIREMENTS["deep-low"]

    // when
    const chain = requirement.fallbackChain

    // then
    expect(chain).toEqual([
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-6-sol-fast", variant: "medium" },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-6-sol",
        variant: "medium",
      }
    ])
  })

  test("neither deep lane carries the other lane's model, so they never substitute each other", () => {
    expect(CATEGORY_MODEL_REQUIREMENTS["deep-low"].fallbackChain.map(({ model }) => model)).toEqual(["gpt-6-sol-fast", "gpt-6-sol"])
    expect(CATEGORY_MODEL_REQUIREMENTS["deep-high"].fallbackChain.map(({ model }) => model)).toEqual(["gpt-6-astra"])
  })

  test("visual-engineering starts with Fable 5.1 max", () => {
    expect(CATEGORY_MODEL_REQUIREMENTS["visual-engineering"].fallbackChain.at(0)).toEqual({
      providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-fable-5-1", variant: "max",
    })
  })

  test("visual-engineering follows the approved 3-rung chain", () => {
    // given
    const requirement = CATEGORY_MODEL_REQUIREMENTS["visual-engineering"]

    // when
    const chain = requirement.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-fable-5-1",
        variant: "max",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max",
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"],
        model: "kimi-k3",
        variant: "max",
      }
    ])
  })

  test("quick follows the approved 8-rung chain", () => {
    // given
    const requirement = CATEGORY_MODEL_REQUIREMENTS["quick"]

    // when
    const chain = requirement.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["openai", "chatgpt-subscription"],
        model: "gpt-6-luna-fast",
        variant: "low",
      },
      {
        providers: ["deepseek"],
        model: "deepseek-flash",
        variant: "off",
      },
      {
        providers: ["qwen-token-plan", "alibaba-token-plan", "bailian-coding-plan"],
        model: "qwen3.6-flash",
        variant: "low",
      },
      {
        providers: ["opencode-go"],
        model: "minimax-m3",
        variant: "max",
      },
      {
        providers: ["opencode-go"],
        model: "minimax-m2.7",
        variant: "max",
      },
      {
        providers: ["xai"],
        model: "grok-4.20-0309-non-reasoning",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot"],
        model: "claude-haiku-4-5",
        variant: "off",
      }
    ])
  })

  test("unspecified-low follows the approved 7-rung chain headed by mimo-v2.6-pro max", () => {
    // given
    const requirement = CATEGORY_MODEL_REQUIREMENTS["unspecified-low"]

    // when
    const chain = requirement.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["xiaomi", "opencode-go"],
        model: "mimo-v2.6-pro",
        variant: "max",
      },
      {
        providers: ["xai", "github-copilot", "opencode-go"],
        model: "grok-4.7",
        variant: "xhigh",
      },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-terra",
        variant: "high",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-sonnet-5",
        variant: "low",
      },
      {
        providers: ["qwen-token-plan", "alibaba-token-plan", "qwen-token-plan-cn", "alibaba-token-plan-cn"],
        model: "qwen3.8-max-preview",
        variant: "max",
      },
      {
        providers: ["deepseek", "opencode-go"],
        model: "deepseek-v4-pro",
        variant: "max",
      },
      {
        providers: ["xiaomi", "opencode-go"],
        model: "mimo-v2.5-pro",
        variant: "max",
      }
    ])
  })

  test("unspecified-high follows the approved Opus-first 3-rung chain", () => {
    // given
    const requirement = CATEGORY_MODEL_REQUIREMENTS["unspecified-high"]

    // when
    const chain = requirement.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "medium",
      },
      {
        providers: ["zai-coding-plan", "opencode-go"],
        model: "glm-5.3",
        variant: "max",
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"],
        model: "kimi-k3",
        variant: "max",
      }
    ])
  })

  test("artistry follows the approved 3-rung chain", () => {
    // given
    const requirement = CATEGORY_MODEL_REQUIREMENTS["artistry"]

    // when
    const chain = requirement.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-fable-5-1",
        variant: "max",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max",
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"],
        model: "kimi-k3",
        variant: "max",
      }
    ])
  })

  test("writing follows the approved 3-rung chain", () => {
    // given
    const requirement = CATEGORY_MODEL_REQUIREMENTS["writing"]

    // when
    const chain = requirement.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-fable-5-1",
        variant: "low",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "low",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-4-6",
        variant: "max",
      }
    ])
  })

  test("the deep lanes and artistry no longer hard-require primary models", () => {
    // given
    const deepLow = CATEGORY_MODEL_REQUIREMENTS["deep-low"]
    const deepHigh = CATEGORY_MODEL_REQUIREMENTS["deep-high"]
    const artistry = CATEGORY_MODEL_REQUIREMENTS["artistry"]

    // when / then
    expect(deepLow.requiresModel).toBeUndefined()
    expect(deepHigh.requiresModel).toBeUndefined()
    expect(artistry.requiresModel).toBeUndefined()
  })

})
