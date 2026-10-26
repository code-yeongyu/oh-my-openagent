import { FABLE_55_LAUNCH, launchRungs } from "./fable-55-launch"
import type { ModelRequirement } from "./model-requirement-types"
import { LATEST_MODEL_BY_FAMILY } from "./latest-models"

export const AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  sisyphus: {
    fallbackChain: [
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.claudeOpus,
        variant: "max",
      },
      {
        providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode", "bailian-coding-plan", "moonshotai-cn", "firmware", "ollama-cloud", "aihubmix"],
        model: LATEST_MODEL_BY_FAMILY.kimi,
      },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
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
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-6-sol",
        variant: "medium",
      },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium",
      }
    ],
    requiresProvider: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
    requiresAnyModel: true,
  },
  oracle: {
    fallbackChain: [
      { providers: ["openai", "chatgpt-subscription", "opencode"], model: "gpt-5.6-sol", variant: "xhigh" },
      { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "high" },
      {
        providers: ["google", "google-vertex", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.geminiPro,
        variant: "high",
      },
      {
        providers: ["google", "github-copilot", "opencode"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.claudeOpus,
        variant: "max",
      },
      { providers: ["opencode-go"], model: "glm-5.2" }
    ],
  },
  librarian: {
    fallbackChain: [
      { providers: ["kimi-for-coding"], model: "kimi-for-coding-highspeed", variant: "off" },
      { providers: ["openai", "chatgpt-subscription"], model: LATEST_MODEL_BY_FAMILY.gptLunaFast, variant: "low" },
      { providers: ["anthropic", "github-copilot"], model: LATEST_MODEL_BY_FAMILY.claudeHaiku, variant: "medium" },
      { providers: ["deepseek"], model: "deepseek-flash", variant: "max" },
      { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
      { providers: ["opencode-go"], model: "minimax-m2.7" }
    ],
  },
  explore: {
    fallbackChain: [
      { providers: ["kimi-for-coding"], model: "kimi-for-coding-highspeed", variant: "off" },
      { providers: ["openai", "chatgpt-subscription"], model: LATEST_MODEL_BY_FAMILY.gptLunaFast, variant: "low" },
      { providers: ["anthropic", "github-copilot"], model: LATEST_MODEL_BY_FAMILY.claudeHaiku, variant: "medium" },
      { providers: ["deepseek"], model: "deepseek-flash", variant: "max" },
      { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
      { providers: ["opencode-go"], model: "minimax-m2.7" }
    ],
  },
  "multimodal-looker": {
    fallbackChain: [
      { providers: ["openai", "chatgpt-subscription", "opencode"], model: "gpt-5.6-sol", variant: "low" },
      { providers: ["opencode-go"], model: LATEST_MODEL_BY_FAMILY.kimi },
      { providers: ["zai-coding-plan"], model: "glm-4.6v" },
      { providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"], model: "gpt-5-nano" }
    ],
  },
  prometheus: {
    fallbackChain: launchRungs([
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: FABLE_55_LAUNCH.id,
        variant: "xhigh",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.claudeFable,
        variant: "xhigh",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.claudeOpus,
        variant: "max",
      },
      {
        providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.kimi,
        variant: "max",
      }
    ]),
  },
  metis: {
    fallbackChain: launchRungs([
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: FABLE_55_LAUNCH.id,
        variant: "max",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.claudeFable,
        variant: "max",
      },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.claudeOpus,
        variant: "max",
      },
      {
        providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.kimi,
        variant: "max",
      }
    ]),
  },
  momus: {
    fallbackChain: [
      { providers: ["openai", "chatgpt-subscription"], model: LATEST_MODEL_BY_FAMILY.gptAstra, variant: "xhigh" },
      { providers: ["github-copilot"], model: LATEST_MODEL_BY_FAMILY.gptAstra, variant: "high" },
      { providers: ["openai", "chatgpt-subscription", "opencode"], model: LATEST_MODEL_BY_FAMILY.gptAstra, variant: "high" },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.claudeOpus,
        variant: "max",
      },
      {
        providers: ["google", "google-vertex", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.geminiPro,
        variant: "high",
      },
      {
        providers: ["google", "github-copilot", "opencode"],
        model: "gemini-3.1-pro",
        variant: "high",
      },
      { providers: ["opencode-go"], model: "glm-5.2" }
    ],
  },
  atlas: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-5" },
      { providers: ["opencode-go"], model: LATEST_MODEL_BY_FAMILY.kimi },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
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
      { providers: ["opencode-go"], model: LATEST_MODEL_BY_FAMILY.kimi },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
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
