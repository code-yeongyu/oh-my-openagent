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
        model: "claude-opus-4-7",
        variant: "max",
      },
      { providers: ["opencode-go", "vercel"], model: "glm-5.1" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
    ],
  },
  ultrabrain: {
    fallbackChain: [
      {
        providers: ["openai", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "xhigh",
      },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      { providers: ["opencode-go", "vercel"], model: "glm-5.1" },
    ],
  },
  deep: {
    fallbackChain: [
      {
        providers: ["openai", "github-copilot", "venice", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "medium",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.6" },
      { providers: ["opencode-go", "vercel"], model: "glm-5.1" },
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
        model: "claude-opus-4-7",
        variant: "max",
      },
      { providers: ["openai", "github-copilot", "opencode", "vercel"], model: "gpt-5.5" },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.6" },
      { providers: ["opencode-go", "vercel"], model: "glm-5.1" },
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
        model: "gemini-3-flash",
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
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-sonnet-4-6",
      },
      {
        providers: ["openai", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "medium",
      },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.6" },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3-flash",
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
        model: "claude-opus-4-7",
        variant: "max",
      },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "high",
      },
      { providers: ["zai-coding-plan", "opencode", "bailian-coding-plan", "vercel"], model: "glm-5" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
      { providers: ["opencode-go", "vercel"], model: "glm-5.1" },
      { providers: ["opencode", "bailian-coding-plan", "vercel"], model: "kimi-k2.5" },
      {
        providers: [
          "opencode",
          "bailian-coding-plan",
          "moonshotai",
          "moonshotai-cn",
          "firmware",
          "ollama-cloud",
          "aihubmix",
          "vercel",
        ],
        model: "kimi-k2.5",
      },
    ],
  },
  writing: {
    fallbackChain: [
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3-flash",
      },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.6" },
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
