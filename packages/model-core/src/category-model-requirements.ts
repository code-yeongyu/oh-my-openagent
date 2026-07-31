import type { ModelRequirement } from "./model-requirement-types"

export const CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  "visual-engineering": {
    fallbackChain: [
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-5",
        variant: "max",
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode", "vercel"],
        model: "kimi-k3",
        variant: "max",
      },
      {
        providers: ["zai-coding-plan", "opencode-go", "vercel"],
        model: "glm-5.2",
        variant: "max",
      },
    ],
  },
  ultrabrain: {
    fallbackChain: [
      {
        providers: ["openai", "vercel"],
        model: "gpt-5.6-sol",
        variant: "xhigh",
      },
      {
        providers: ["github-copilot"],
        model: "gpt-5.6-sol",
        variant: "high",
      },
      {
        providers: ["openai", "opencode", "vercel"],
        model: "gpt-5.6-sol",
        variant: "xhigh",
      },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-5",
        variant: "max",
      },
      { providers: ["opencode-go", "vercel"], model: "glm-5.2" },
    ],
  },
  deep: {
    fallbackChain: [
      {
        providers: ["openai", "quotio-openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.6-sol",
        variant: "medium",
      },
    ],
  },
  artistry: {
    fallbackChain: [
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode", "vercel"],
        model: "claude-fable-5",
        variant: "xhigh",
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode", "vercel"],
        model: "kimi-k3",
        variant: "max",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-5",
        variant: "xhigh",
      },
    ],
  },
  quick: {
    fallbackChain: [
      { providers: ["kimi-for-coding"], model: "kimi-for-coding-highspeed" },
      { providers: ["quotio-openai"], model: "gpt-5.4-mini-fast", variant: "minimal" },
      { providers: ["openai"], model: "gpt-5.4-mini", variant: "minimal" },
      { providers: ["xai"], model: "grok-4.20-0309-non-reasoning" },
      { providers: ["xiaomi"], model: "mimo-v2.5-pro-ultraspeed" },
    ],
  },
  "unspecified-low": {
    fallbackChain: [
      {
        providers: ["openai", "quotio-openai", "vercel"],
        model: "gpt-5.6-luna",
        variant: "xhigh",
      },
      {
        providers: ["github-copilot"],
        model: "gpt-5.6-luna",
        variant: "high",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode", "vercel"],
        model: "claude-sonnet-5",
        variant: "medium",
      },
      {
        providers: ["qwen-token-plan", "alibaba-token-plan", "qwen-token-plan-cn", "alibaba-token-plan-cn"],
        model: "qwen3.8-max-preview",
        variant: "max",
      },
      {
        providers: ["deepseek", "opencode-go", "vercel"],
        model: "deepseek-v4-pro",
        variant: "max",
      },
      {
        providers: ["xiaomi", "opencode-go", "vercel"],
        model: "mimo-v2.5-pro",
        variant: "max",
      },
      { providers: ["cursor"], model: "composer-2.5" },
    ],
  },
  "unspecified-high": {
    fallbackChain: [
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode", "vercel"],
        model: "kimi-k3",
        variant: "max",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-5",
        variant: "xhigh",
      },
      {
        providers: ["openai", "quotio-openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.6-sol",
        variant: "high",
      },
    ],
  },
  writing: {
    fallbackChain: [
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode", "vercel"],
        model: "kimi-k3",
        variant: "low",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-5",
        variant: "low",
      },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.6-flash",
      },
    ],
  },
};
