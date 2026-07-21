import type { ModelRequirement } from "./model-requirement-types"

export const AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  sisyphus: {
    fallbackChain: [
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-4-7",
        variant: "max",
      },
      { providers: ["opencode-go", "moonshotai", "opencode", "vercel"], model: "kimi-k3" },
      { providers: ["kimi-for-coding"], model: "k3" },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.6" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
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
      { providers: ["openai", "github-copilot", "opencode", "vercel"], model: "gpt-5.5", variant: "medium" },
      { providers: ["zai-coding-plan", "opencode", "bailian-coding-plan", "vercel"], model: "glm-5" },
      { providers: ["opencode"], model: "big-pickle" },
    ],
    requiresAnyModel: true,
  },
  hephaestus: {
    fallbackChain: [
      {
        providers: ["openai", "github-copilot", "vercel"],
        model: "gpt-5.6-sol",
        variant: "high",
      },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "medium",
      },
    ],
    requiresProvider: ["openai", "github-copilot", "opencode", "vercel"],
    requiresAnyModel: true,
  },
  oracle: {
    fallbackChain: [
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "high",
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
      { providers: ["opencode-go", "vercel"], model: "glm-5.2" },
    ],
  },
  librarian: {
    fallbackChain: [
      { providers: ["openai"], model: "gpt-5.4-mini-fast" },
      { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.5-plus" },
      { providers: ["vercel"], model: "minimax-m2.7-highspeed" },
      { providers: ["opencode-go", "vercel"], model: "minimax-m3" },
      { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
      { providers: ["anthropic", "github-copilot", "vercel"], model: "claude-haiku-4-5" },
      { providers: ["openai", "vercel"], model: "gpt-5.4-nano" },
    ],
  },
  explore: {
    fallbackChain: [
      { providers: ["openai"], model: "gpt-5.4-mini-fast" },
      { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.5-plus" },
      { providers: ["vercel"], model: "minimax-m2.7-highspeed" },
      { providers: ["opencode-go", "vercel"], model: "minimax-m3" },
      { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
      { providers: ["anthropic", "github-copilot", "vercel"], model: "claude-haiku-4-5" },
      { providers: ["openai", "vercel"], model: "gpt-5.4-nano" },
    ],
  },
  "multimodal-looker": {
    fallbackChain: [
      { providers: ["openai", "opencode", "vercel"], model: "gpt-5.5", variant: "medium" },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.6" },
      { providers: ["zai-coding-plan", "vercel"], model: "glm-4.6v" },
      { providers: ["openai", "github-copilot", "opencode", "vercel"], model: "gpt-5-nano" },
    ],
  },
  prometheus: {
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
      { providers: ["opencode-go", "vercel"], model: "glm-5.2" },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.1-pro",
      },
    ],
  },
  metis: {
    fallbackChain: [
      {
        providers: ["anthropic", "github-copilot", "opencode", "vercel"],
        model: "claude-sonnet-4-6",
      },
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
      { providers: ["opencode-go", "vercel"], model: "glm-5.2" },
      { providers: ["kimi-for-coding"], model: "k2p5" },
    ],
  },
  momus: {
    fallbackChain: [
      {
        providers: ["openai", "vercel"],
        model: "gpt-5.6-terra",
        variant: "high",
      },
      {
        providers: ["github-copilot"],
        model: "gpt-5.6-terra",
        variant: "high",
      },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "xhigh",
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
      { providers: ["opencode-go", "vercel"], model: "glm-5.2" },
    ],
  },
  atlas: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode", "vercel"], model: "claude-sonnet-4-6" },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.6" },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "medium",
      },
      { providers: ["opencode-go", "vercel"], model: "minimax-m3" },
      { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
    ],
  },
  "sisyphus-junior": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode", "vercel"], model: "claude-sonnet-4-6" },
      { providers: ["opencode-go", "vercel"], model: "kimi-k2.6" },
      {
        providers: ["openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.5",
        variant: "medium",
      },
      { providers: ["opencode-go", "vercel"], model: "minimax-m3" },
      { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
      { providers: ["opencode"], model: "big-pickle" },
    ],
  },
};
