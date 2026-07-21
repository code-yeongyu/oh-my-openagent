import type { ModelRequirement } from "./model-requirement-types"

export const CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  "visual-engineering": {
    fallbackChain: [
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      { providers: ["zai-coding-plan", "opencode", "bailian-coding-plan", "vercel"], model: "glm-5" },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-8",
        variant: "max",
      },
      { providers: ["opencode-go", "vercel"], model: "glm-5.2" },
      { providers: ["kimi-for-coding"], model: "kimi-k3" },
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
        model: "claude-opus-4-8",
        variant: "max",
      },
      { providers: ["opencode-go", "vercel"], model: "glm-5.2" },
    ],
  },
  deep: {
    fallbackChain: [
      {
        providers: ["openai", "vercel"],
        model: "gpt-5.6-terra",
        variant: "xhigh",
      },
      {
        providers: ["github-copilot"],
        model: "gpt-5.6-terra",
        variant: "high",
      },
      {
        providers: ["openai", "github-copilot", "vercel"],
        model: "gpt-5.6-sol",
        variant: "high",
      },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.6-sol",
        variant: "medium",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-8",
        variant: "max",
      },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      { providers: ["opencode-go", "vercel"], model: "kimi-k3" },
      { providers: ["opencode-go", "vercel"], model: "glm-5.2" },
    ],
  },
  artistry: {
    fallbackChain: [
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-8",
        variant: "max",
      },
      { providers: ["openai", "github-copilot", "opencode", "vercel"], model: "gpt-5.6-sol", variant: "high" },
      { providers: ["opencode-go", "vercel"], model: "kimi-k3" },
      { providers: ["opencode-go", "vercel"], model: "glm-5.2" },
    ],
  },
  quick: {
    fallbackChain: [
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.4-mini",
      },
      {
        providers: ["anthropic", "github-copilot", "vercel"],
        model: "claude-haiku-4-5",
      },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.6-flash",
      },
      { providers: ["opencode-go", "vercel"], model: "minimax-m3" },
      { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
      { providers: ["opencode", "vercel"], model: "gpt-5-nano" },
    ],
  },
  "unspecified-low": {
    fallbackChain: [
      {
        providers: ["openai", "vercel"],
        model: "gpt-5.6-luna",
        variant: "xhigh",
      },
      {
        providers: ["github-copilot"],
        model: "gpt-5.6-luna",
        variant: "high",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-sonnet-4-6",
      },
      {
        providers: ["openai", "opencode", "vercel"],
        model: "gpt-5.6-sol",
        variant: "medium",
      },
      { providers: ["opencode-go", "vercel"], model: "kimi-k3" },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.6-flash",
      },
      { providers: ["opencode-go", "vercel"], model: "minimax-m3" },
      { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
    ],
  },
  "unspecified-high": {
    fallbackChain: [
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-8",
        variant: "max",
      },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.6-sol",
        variant: "high",
      },
      { providers: ["zai-coding-plan", "opencode", "bailian-coding-plan", "vercel"], model: "glm-5" },
      { providers: ["kimi-for-coding"], model: "kimi-k3" },
      { providers: ["opencode-go", "vercel"], model: "glm-5.2" },
      {
        providers: [
          "opencode",
          "bailian-coding-plan",
          "vercel",
          "moonshotai",
          "moonshotai-cn",
          "firmware",
          "ollama-cloud",
          "aihubmix",
        ],
        model: "kimi-k3",
      },
    ],
  },
  writing: {
    fallbackChain: [
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.6-flash",
      },
      { providers: ["opencode-go", "vercel"], model: "kimi-k3" },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-sonnet-4-6",
      },
      { providers: ["opencode-go", "vercel"], model: "minimax-m3" },
      { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
    ],
  },
};
