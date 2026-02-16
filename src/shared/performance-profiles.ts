import type { ModelRequirement } from "./model-requirements"
import type { PerformanceProfileSchema } from "../config/schema/oh-my-opencode-config"
import type { z } from "zod"
import { AGENT_MODEL_REQUIREMENTS } from "./model-requirements"

type PerformanceProfile = z.infer<typeof PerformanceProfileSchema>

type ProfileAgentName =
  | "sisyphus"
  | "hephaestus"
  | "oracle"
  | "librarian"
  | "explore"
  | "multimodal-looker"
  | "prometheus"
  | "metis"
  | "momus"
  | "atlas"
  | "sisyphus-junior"

export const AGENT_PROFILE_REQUIREMENTS: Record<
  PerformanceProfile,
  Record<ProfileAgentName, ModelRequirement>
> = {
  performance: {
    sisyphus: {
      fallbackChain: [
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
        { providers: ["kimi-for-coding"], model: "k2p5" },
        { providers: ["opencode"], model: "kimi-k2.5-free" },
        { providers: ["zai-coding-plan"], model: "glm-4.7" },
        { providers: ["opencode"], model: "glm-4.7-free" },
      ],
      requiresAnyModel: true,
    },
    hephaestus: {
      fallbackChain: [
        { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.3-codex", variant: "medium" },
      ],
      requiresProvider: ["openai", "github-copilot", "opencode"],
    },
    oracle: {
      fallbackChain: [
        { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
        { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "high" },
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
      ],
    },
    librarian: {
      fallbackChain: [
        { providers: ["zai-coding-plan"], model: "glm-4.7" },
        { providers: ["opencode"], model: "glm-4.7-free" },
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
      ],
    },
    explore: {
      fallbackChain: [
        { providers: ["github-copilot"], model: "grok-code-fast-1" },
        { providers: ["anthropic", "opencode"], model: "claude-haiku-4-5" },
        { providers: ["opencode"], model: "gpt-5-nano" },
      ],
    },
    "multimodal-looker": {
      fallbackChain: [
        { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-flash" },
        { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2" },
        { providers: ["zai-coding-plan"], model: "glm-4.6v" },
        { providers: ["kimi-for-coding"], model: "k2p5" },
        { providers: ["opencode"], model: "kimi-k2.5-free" },
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" },
        { providers: ["opencode"], model: "gpt-5-nano" },
      ],
    },
    prometheus: {
      fallbackChain: [
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
        { providers: ["kimi-for-coding"], model: "k2p5" },
        { providers: ["opencode"], model: "kimi-k2.5-free" },
        { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
        { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
      ],
    },
    metis: {
      fallbackChain: [
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
        { providers: ["kimi-for-coding"], model: "k2p5" },
        { providers: ["opencode"], model: "kimi-k2.5-free" },
        { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
        { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "high" },
      ],
    },
    momus: {
      fallbackChain: [
        { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "medium" },
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" },
        { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro", variant: "high" },
      ],
    },
    atlas: {
      fallbackChain: [
        { providers: ["kimi-for-coding"], model: "k2p5" },
        { providers: ["opencode"], model: "kimi-k2.5-free" },
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
        { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2" },
        { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
      ],
    },
    "sisyphus-junior": {
      fallbackChain: [
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
        { providers: ["kimi-for-coding"], model: "k2p5" },
        { providers: ["opencode"], model: "kimi-k2.5-free" },
        { providers: ["anthropic", "opencode"], model: "claude-haiku-4-5" },
      ],
    },
  },
  balanced: {
    sisyphus: {
      fallbackChain: [
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
        { providers: ["kimi-for-coding"], model: "k2p5" },
        { providers: ["opencode"], model: "kimi-k2.5-free" },
        { providers: ["zai-coding-plan"], model: "glm-4.7" },
        { providers: ["opencode"], model: "glm-4.7-free" },
      ],
      requiresAnyModel: true,
    },
    hephaestus: {
      fallbackChain: [
        { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.3-codex", variant: "medium" },
      ],
      requiresProvider: ["openai", "github-copilot", "opencode"],
    },
    oracle: {
      fallbackChain: [
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
        { providers: ["kimi-for-coding"], model: "k2p5" },
        { providers: ["opencode"], model: "kimi-k2.5-free" },
        { providers: ["zai-coding-plan"], model: "glm-4.7" },
        { providers: ["opencode"], model: "glm-4.7-free" },
      ],
    },
    librarian: {
      fallbackChain: [
        { providers: ["zai-coding-plan"], model: "glm-4.7" },
        { providers: ["opencode"], model: "glm-4.7-free" },
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
      ],
    },
    explore: {
      fallbackChain: [
        { providers: ["github-copilot"], model: "grok-code-fast-1" },
        { providers: ["anthropic", "opencode"], model: "claude-haiku-4-5" },
        { providers: ["opencode"], model: "gpt-5-nano" },
      ],
    },
    "multimodal-looker": {
      fallbackChain: [
        { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-flash" },
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" },
        { providers: ["opencode"], model: "gpt-5-nano" },
      ],
    },
    prometheus: {
      fallbackChain: [
        { providers: ["kimi-for-coding"], model: "k2p5" },
        { providers: ["opencode"], model: "kimi-k2.5-free" },
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
        { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2" },
      ],
    },
    metis: {
      fallbackChain: [
        { providers: ["kimi-for-coding"], model: "k2p5" },
        { providers: ["opencode"], model: "kimi-k2.5-free" },
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
        { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2" },
      ],
    },
    momus: {
      fallbackChain: [
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
        { providers: ["kimi-for-coding"], model: "k2p5" },
        { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
      ],
    },
    atlas: {
      fallbackChain: [
        { providers: ["kimi-for-coding"], model: "k2p5" },
        { providers: ["opencode"], model: "kimi-k2.5-free" },
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
        { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2" },
      ],
    },
    "sisyphus-junior": {
      fallbackChain: [
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
        { providers: ["kimi-for-coding"], model: "k2p5" },
        { providers: ["opencode"], model: "kimi-k2.5-free" },
        { providers: ["anthropic", "opencode"], model: "claude-haiku-4-5" },
      ],
    },
  },
  budget: {
    sisyphus: {
      fallbackChain: [
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" },
        { providers: ["opencode"], model: "gpt-5-nano" },
        { providers: ["zai-coding-plan"], model: "glm-4.7-free" },
      ],
      requiresAnyModel: true,
    },
    hephaestus: {
      fallbackChain: [
        { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.3-codex", variant: "medium" },
      ],
      requiresProvider: ["openai", "github-copilot", "opencode"],
    },
    oracle: {
      fallbackChain: [
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" },
        { providers: ["opencode"], model: "gpt-5-nano" },
        { providers: ["zai-coding-plan"], model: "glm-4.7-free" },
      ],
    },
    librarian: {
      fallbackChain: [
        { providers: ["zai-coding-plan"], model: "glm-4.7-free" },
        { providers: ["anthropic", "opencode"], model: "claude-haiku-4-5" },
        { providers: ["opencode"], model: "gpt-5-nano" },
      ],
    },
    explore: {
      fallbackChain: [
        { providers: ["github-copilot"], model: "grok-code-fast-1" },
        { providers: ["opencode"], model: "gpt-5-nano" },
      ],
    },
    "multimodal-looker": {
      fallbackChain: [
        { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-flash" },
        { providers: ["opencode"], model: "gpt-5-nano" },
      ],
    },
    prometheus: {
      fallbackChain: [
        { providers: ["opencode"], model: "kimi-k2.5-free" },
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" },
        { providers: ["opencode"], model: "gpt-5-nano" },
      ],
    },
    metis: {
      fallbackChain: [
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" },
        { providers: ["opencode"], model: "gpt-5-nano" },
        { providers: ["zai-coding-plan"], model: "glm-4.7-free" },
      ],
    },
    momus: {
      fallbackChain: [
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" },
        { providers: ["opencode"], model: "gpt-5-nano" },
        { providers: ["zai-coding-plan"], model: "glm-4.7-free" },
      ],
    },
    atlas: {
      fallbackChain: [
        { providers: ["opencode"], model: "kimi-k2.5-free" },
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-haiku-4-5" },
        { providers: ["opencode"], model: "gpt-5-nano" },
      ],
    },
    "sisyphus-junior": {
      fallbackChain: [
        { providers: ["anthropic", "opencode"], model: "claude-haiku-4-5" },
        { providers: ["opencode"], model: "gpt-5-nano" },
      ],
    },
  },
}

/**
 * Get agent model requirements adjusted for a specific performance profile.
 * Profile-specific requirements override the default AGENT_MODEL_REQUIREMENTS.
 *
 * @param profile - The performance profile to use ("performance", "balanced", or "budget")
 * @returns A merged record of agent model requirements with profile adjustments applied
 */
export function getAgentModelRequirementsForProfile(
  profile: PerformanceProfile,
): Record<string, ModelRequirement> {
  const profileRequirements = AGENT_PROFILE_REQUIREMENTS[profile]

  return {
    ...AGENT_MODEL_REQUIREMENTS,
    ...profileRequirements,
  }
}
