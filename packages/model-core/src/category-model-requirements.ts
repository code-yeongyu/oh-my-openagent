import type { ModelRequirement } from "./model-requirement-types"

export const CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  "visual-engineering": {
    fallbackChain: [
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
      { providers: ["zai-coding-plan", "opencode-go"], model: "glm-5.2", variant: "max" },
      {
        providers: ["openai", "openai-codex", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium",
      }
    ],
  },
  ultrabrain: {
    fallbackChain: [
      { providers: ["openai", "openai-codex"], model: "gpt-5.6-sol", variant: "max" },
      { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "max" },
      { providers: ["openai", "openai-codex", "opencode"], model: "gpt-5.6-sol", variant: "max" }
    ],
  },
  deep: {
    fallbackChain: [
      {
        providers: ["openai", "openai-codex", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium",
      }
    ],
  },
  artistry: {
    fallbackChain: [
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
    ],
  },
  quick: {
    fallbackChain: [
      { providers: ["kimi-for-coding"], model: "kimi-for-coding-highspeed" },
      { providers: ["openai-codex"], model: "gpt-5.6-luna-fast", variant: "low" },
      { providers: ["deepseek"], model: "deepseek-v4-flash", variant: "off" },
      {
        providers: ["qwen-token-plan", "alibaba-token-plan", "bailian-coding-plan"],
        model: "qwen3.6-flash",
        variant: "low",
      },
      { providers: ["opencode-go"], model: "minimax-m3", variant: "max" },
      { providers: ["opencode-go"], model: "minimax-m2.7", variant: "max" },
      { providers: ["xai"], model: "grok-4.20-0309-non-reasoning" },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot"],
        model: "claude-haiku-4-5",
        variant: "off",
      }
    ],
  },
  "unspecified-low": {
    fallbackChain: [
      { providers: ["xai", "github-copilot", "opencode"], model: "grok-4.6", variant: "xhigh" },
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
      { providers: ["deepseek", "opencode-go"], model: "deepseek-v4-pro", variant: "max" },
      { providers: ["xiaomi", "opencode-go"], model: "mimo-v2.5-pro", variant: "max" }
    ],
  },
  "unspecified-high": {
    fallbackChain: [
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5",
        variant: "xhigh",
      },
      { providers: ["zai-coding-plan", "opencode-go"], model: "glm-5.3", variant: "max" },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"],
        model: "kimi-k3",
        variant: "max",
      }
    ],
  },
  writing: {
    fallbackChain: [
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
      { providers: ["google", "github-copilot", "opencode"], model: "gemini-3.6-flash" }
    ],
  },
}
