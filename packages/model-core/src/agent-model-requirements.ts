import type { ModelRequirement } from "./model-requirement-types"

export const AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  sisyphus: {
    fallbackChain: [
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-5",
        variant: "max",
      },
      {
        providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode", "bailian-coding-plan", "moonshotai-cn", "firmware", "ollama-cloud", "aihubmix"],
        model: "kimi-k3",
      },
      {
        providers: ["openai", "openai-codex", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium",
      },
      { providers: ["zai-coding-plan", "opencode", "bailian-coding-plan"], model: "glm-5.2" },
      { providers: ["opencode"], model: "big-pickle" }
    ],
    requiresAnyModel: true,
  },
  hephaestus: {
    fallbackChain: [
      {
        providers: ["openai", "openai-codex", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium",
      }
    ],
    requiresProvider: ["openai", "openai-codex", "github-copilot", "opencode"],
    requiresAnyModel: true,
  },
  oracle: {
    fallbackChain: [
      { providers: ["openai", "openai-codex", "opencode"], model: "gpt-5.6-sol", variant: "xhigh" },
      { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "high" },
      {
        providers: ["google", "github-copilot", "opencode"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-5",
        variant: "max",
      },
      { providers: ["opencode-go"], model: "glm-5.2" }
    ],
  },
  librarian: {
    fallbackChain: [
      { providers: ["openai", "openai-codex"], model: "gpt-5.6-luna-fast", variant: "low" },
      { providers: ["deepseek"], model: "deepseek-v4-flash", variant: "max" },
      { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
      { providers: ["opencode-go"], model: "minimax-m3" },
      { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
      { providers: ["opencode-go"], model: "minimax-m2.7" },
      { providers: ["anthropic", "github-copilot"], model: "claude-haiku-4-5" },
      { providers: ["openai", "openai-codex"], model: "gpt-5.4-nano" }
    ],
  },
  explore: {
    fallbackChain: [
      { providers: ["openai", "openai-codex"], model: "gpt-5.6-luna-fast", variant: "low" },
      { providers: ["deepseek"], model: "deepseek-v4-flash", variant: "max" },
      { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
      { providers: ["opencode-go"], model: "minimax-m3" },
      { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
      { providers: ["opencode-go"], model: "minimax-m2.7" },
      { providers: ["anthropic", "github-copilot"], model: "claude-haiku-4-5" },
      { providers: ["openai", "openai-codex"], model: "gpt-5.4-nano" }
    ],
  },
  "multimodal-looker": {
    fallbackChain: [
      { providers: ["openai", "openai-codex", "opencode"], model: "gpt-5.6-sol", variant: "low" },
      { providers: ["opencode-go"], model: "kimi-k3" },
      { providers: ["zai-coding-plan"], model: "glm-4.6v" },
      { providers: ["openai", "openai-codex", "github-copilot", "opencode"], model: "gpt-5-nano" }
    ],
  },
  prometheus: {
    fallbackChain: [
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-fable-5",
        variant: "xhigh",
      },
      {
        providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode"],
        model: "kimi-k3",
        variant: "max",
      }
    ],
  },
  metis: {
    fallbackChain: [
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-5",
        variant: "high",
      },
      {
        providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode"],
        model: "kimi-k3",
        variant: "low",
      }
    ],
  },
  momus: {
    fallbackChain: [
      { providers: ["openai", "openai-codex"], model: "gpt-5.6-terra", variant: "high" },
      { providers: ["github-copilot"], model: "gpt-5.6-terra", variant: "high" },
      { providers: ["openai", "openai-codex", "opencode"], model: "gpt-5.6-sol", variant: "xhigh" },
      { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "high" },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-5",
        variant: "max",
      },
      {
        providers: ["google", "github-copilot", "opencode"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      { providers: ["opencode-go"], model: "glm-5.2" }
    ],
  },
  "omo-senpi-code-reviewer": {
    fallbackChain: [
      { providers: ["openai", "openai-codex"], model: "gpt-5.6-terra", variant: "medium" },
      { providers: ["github-copilot"], model: "gpt-5.6-terra", variant: "medium" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" },
      { providers: ["opencode-go"], model: "glm-5.2" },
      { providers: ["kimi-for-coding"], model: "kimi-k3" }
    ],
  },
  "omo-senpi-qa-executor": {
    fallbackChain: [
      { providers: ["openai", "openai-codex"], model: "gpt-5.6-luna", variant: "high" },
      { providers: ["github-copilot"], model: "gpt-5.6-luna", variant: "high" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" },
      { providers: ["opencode-go"], model: "glm-5.2" },
      { providers: ["kimi-for-coding"], model: "kimi-k3" }
    ],
  },
  "omo-senpi-gate-reviewer": {
    fallbackChain: [
      { providers: ["openai", "openai-codex"], model: "gpt-5.6-sol", variant: "low" },
      { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "low" },
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-5", variant: "max" },
      { providers: ["opencode-go"], model: "glm-5.2" },
      { providers: ["kimi-for-coding"], model: "kimi-k3" }
    ],
  },
  atlas: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-5" },
      { providers: ["opencode-go"], model: "kimi-k3" },
      {
        providers: ["openai", "openai-codex", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium",
      },
      { providers: ["opencode-go"], model: "minimax-m3" },
      { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
      { providers: ["opencode-go"], model: "minimax-m2.7" }
    ],
  },
  "sisyphus-junior": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-5" },
      { providers: ["opencode-go"], model: "kimi-k3" },
      {
        providers: ["openai", "openai-codex", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium",
      },
      { providers: ["opencode-go"], model: "minimax-m3" },
      { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
      { providers: ["opencode-go"], model: "minimax-m2.7" },
      { providers: ["opencode"], model: "big-pickle" }
    ],
  },
}
