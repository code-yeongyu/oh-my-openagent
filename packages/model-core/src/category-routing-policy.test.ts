import { describe, expect, test } from "bun:test"

import { CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

describe("category routing policy", () => {
  test("visual-engineering prioritizes Opus max, Kimi K3 max, GLM 5.2 max, then Sol medium", () => {
    // given
    const visual = CATEGORY_MODEL_REQUIREMENTS["visual-engineering"]

    // when
    const leadingChain = visual.fallbackChain

    // then
    expect(leadingChain).toEqual([
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5",
        variant: "max",
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"],
        model: "kimi-k3",
        variant: "max",
      },
      {
        providers: ["zai-coding-plan", "opencode-go"],
        model: "glm-5.2",
        variant: "max",
      },
      {
        providers: ["openai", "openai-codex", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium",
      }
    ])
  })

  test("deep is limited to a single sol-family medium rung", () => {
    // given
    const deep = CATEGORY_MODEL_REQUIREMENTS["deep"]

    // when
    const chain = deep.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["openai", "openai-codex", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium",
      }
    ])
  })

  test("quick prioritizes Kimi high-speed, Luna low, DeepSeek off, then the speed tier", () => {
    // given
    const quick = CATEGORY_MODEL_REQUIREMENTS["quick"]

    // when
    const leadingChain = quick.fallbackChain

    // then
    expect(leadingChain).toEqual([
      {
        providers: ["kimi-for-coding"],
        model: "kimi-for-coding-highspeed",
      },
      {
        providers: ["openai-codex"],
        model: "gpt-5.6-luna-fast",
        variant: "low",
      },
      {
        providers: ["deepseek"],
        model: "deepseek-v4-flash",
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

  test("unspecified-low follows the approved 6-rung chain headed by grok-4.6 xhigh", () => {
    // given
    const unspecifiedLow = CATEGORY_MODEL_REQUIREMENTS["unspecified-low"]

    // when
    const chain = unspecifiedLow.fallbackChain

    // then
    expect(chain.map((entry) => entry.model)).not.toContain("gpt-5.6-luna")
    expect(chain).toEqual([
      {
        providers: ["xai", "github-copilot", "opencode"],
        model: "grok-4.6",
        variant: "xhigh",
      },
      {
        providers: ["openai", "openai-codex", "github-copilot", "opencode"],
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

  test("unspecified-high, artistry, and writing follow the approved kimi-for-coding chains", () => {
    // given
    const unspecifiedHigh = CATEGORY_MODEL_REQUIREMENTS["unspecified-high"]
    const artistry = CATEGORY_MODEL_REQUIREMENTS["artistry"]
    const writing = CATEGORY_MODEL_REQUIREMENTS["writing"]

    // when
    const highChain = unspecifiedHigh.fallbackChain
    const artistryChain = artistry.fallbackChain
    const writingChain = writing.fallbackChain

    // then
    expect(highChain).toEqual([
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5",
        variant: "xhigh",
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
    expect(artistryChain).toEqual([
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-fable-5",
        variant: "xhigh",
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"],
        model: "kimi-k3",
        variant: "max",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5",
        variant: "xhigh",
      }
    ])
    expect(writingChain).toEqual([
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"],
        model: "kimi-k3",
        variant: "low",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5",
        variant: "low",
      },
      {
        providers: ["google", "github-copilot", "opencode"],
        model: "gemini-3.6-flash",
      }
    ])
  })
})
