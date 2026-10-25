import type { ModelRequirement } from "./model-requirement-types"
import { LATEST_MODEL_BY_FAMILY } from "./latest-models"

export const CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  "visual-engineering": {
    fallbackChain: [
      // Argon at its lowest accepted thinking level leads (#10187): off/minimal map to null for
      // this model, so `low` is the floor; Copilot joins once code-yeongyu/senpi#3379 verifies its
      // thinking control. The rung is unresolvable until the engine catalog carries the model.
      { providers: ["google", "google-vertex", "opencode"], model: LATEST_MODEL_BY_FAMILY.geminiPro, variant: "low" },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.claudeFable,
        variant: "max",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.claudeOpus,
        variant: "max",
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.kimi,
        variant: "max",
      }
    ],
  },
  ultrabrain: {
    fallbackChain: [
      { providers: ["openai", "chatgpt-subscription"], model: LATEST_MODEL_BY_FAMILY.gptAstra, variant: "max" },
      { providers: ["github-copilot"], model: LATEST_MODEL_BY_FAMILY.gptAstra, variant: "max" },
      { providers: ["openai", "chatgpt-subscription", "opencode"], model: LATEST_MODEL_BY_FAMILY.gptAstra, variant: "max" },
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-5.6-sol", variant: "max" },
      { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "max" },
      { providers: ["openai", "chatgpt-subscription", "opencode"], model: "gpt-5.6-sol", variant: "max" }
    ],
  },
  "deep-low": {
    fallbackChain: [
      // GPT-6.1 Sol leads at the same medium effort: it matches GPT-6 Sol's price with near-Astra
      // quality, but only the OpenAI lanes serve it (plain, then the Fast tier). GPT-5.6 Sol stays
      // behind it so Copilot, OpenCode Zen and a registry without 6.1 still resolve the lane.
      { providers: ["openai", "chatgpt-subscription"], model: LATEST_MODEL_BY_FAMILY.gptSol, variant: "medium" },
      { providers: ["openai", "chatgpt-subscription"], model: LATEST_MODEL_BY_FAMILY.gptSolFast, variant: "medium" },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium",
      },
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-5.6-sol-fast", variant: "medium" }
    ],
  },
  "deep-high": {
    fallbackChain: [
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.gptAstra,
        variant: "high",
      }
    ],
  },
  artistry: {
    fallbackChain: [
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.claudeFable,
        variant: "max",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.claudeOpus,
        variant: "max",
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.kimi,
        variant: "max",
      }
    ],
  },
  quick: {
    fallbackChain: [
      { providers: ["openai", "chatgpt-subscription"], model: LATEST_MODEL_BY_FAMILY.gptLunaFast, variant: "low" },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot"],
        model: LATEST_MODEL_BY_FAMILY.claudeHaiku,
        variant: "medium",
      },
      { providers: ["deepseek"], model: "deepseek-flash", variant: "off" },
      {
        providers: ["qwen-token-plan", "alibaba-token-plan", "bailian-coding-plan"],
        model: "qwen3.6-flash",
        variant: "low",
      },
      { providers: ["opencode-go"], model: "minimax-m3", variant: "max" },
      { providers: ["opencode-go"], model: "minimax-m2.7", variant: "max" },
      { providers: ["xai"], model: "grok-4.20-0309-non-reasoning" },
      // Trailing: only a Z.ai-only or Xiaomi-only machine reaches these (#9202).
      { providers: ["zai-coding-plan"], model: LATEST_MODEL_BY_FAMILY.glmFlash, variant: "low" },
      { providers: ["xiaomi"], model: "mimo-v2.6-flash", variant: "low" }
    ],
  },
  "unspecified-low": {
    fallbackChain: [
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.claudeSonnet,
        variant: "medium",
      },
      { providers: ["xiaomi", "opencode-go"], model: "mimo-v2.6-pro", variant: "max" },
      { providers: ["xai", "github-copilot", "opencode-go"], model: "grok-4.7", variant: "xhigh" },
      // GLM 5.3 sits ahead of the GPT rungs so a Claude + Z.ai user does not fall from Sonnet to GPT (#10306).
      { providers: ["zai-coding-plan", "opencode-go"], model: LATEST_MODEL_BY_FAMILY.glm, variant: "high" },
      // GPT-6.1 Sol is the current GPT default, served only by the OpenAI lanes; GPT-5.6 Sol stays
      // behind it so Copilot, OpenCode Zen and a registry without 6.1 still resolve the lane (#9844).
      { providers: ["openai", "chatgpt-subscription"], model: LATEST_MODEL_BY_FAMILY.gptSol, variant: "medium" },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium",
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
        model: LATEST_MODEL_BY_FAMILY.claudeOpus,
        variant: "medium",
      },
      { providers: ["zai-coding-plan", "opencode-go"], model: LATEST_MODEL_BY_FAMILY.glm, variant: "max" },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.kimi,
        variant: "max",
      }
    ],
  },
  writing: {
    // Writing runs on its own rungs only: with none of these models reachable the lane is unavailable
    // instead of borrowing another family through the session or system default.
    requiresAnyModel: true,
    fallbackChain: [
      // Argon at its lowest accepted thinking level leads (#10187): off/minimal map to null for
      // this model, so `low` is the floor; Copilot joins once code-yeongyu/senpi#3379 verifies its
      // thinking control. The rung is unresolvable until the engine catalog carries the model.
      { providers: ["google", "google-vertex", "opencode"], model: LATEST_MODEL_BY_FAMILY.geminiPro, variant: "low" },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: LATEST_MODEL_BY_FAMILY.claudeOpus,
        variant: "low",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-4-6",
        variant: "max",
      }
    ],
  },
}
