export type FallbackEntry = {
  providers: string[];
  model: string;
  variant?: string; // Entry-specific variant (e.g., GPT→high, Opus→max)
  reasoningEffort?: string;
  temperature?: number;
  top_p?: number;
  maxTokens?: number;
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number };
};

export type ModelRequirement = {
  fallbackChain: FallbackEntry[];
  variant?: string; // Default variant (used when entry doesn't specify one)
  requiresModel?: string; // If set, only activates when this model is available (fuzzy match)
  requiresAnyModel?: boolean; // If true, requires at least ONE model in fallbackChain to be available (or empty availability treated as unavailable)
  requiresProvider?: string[]; // If set, only activates when any of these providers is connected
};

/**
 * OpenCode Go Only Configuration
 * Complex tasks: opencode-go/glm-5.1
 * Simple tasks: opencode-go/minimax-m2.7
 */
export const AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  // Primary orchestrator - complex reasoning
  sisyphus: {
    fallbackChain: [
      { providers: ["opencode-go"], model: "glm-5.1" },
      { providers: ["opencode-go"], model: "glm-5" },
      { providers: ["opencode-go"], model: "kimi-k2.5" },
      { providers: ["opencode-go"], model: "minimax-m2.7" },
    ],
    requiresAnyModel: true,
  },
  // Deep autonomous worker - complex tasks
  hephaestus: {
    fallbackChain: [
      { providers: ["opencode-go"], model: "glm-5.1" },
      { providers: ["opencode-go"], model: "glm-5" },
    ],
    requiresProvider: ["opencode-go"],
  },
  // Architecture/debugging - complex reasoning
  oracle: {
    fallbackChain: [
      { providers: ["opencode-go"], model: "glm-5.1" },
      { providers: ["opencode-go"], model: "glm-5" },
      { providers: ["opencode-go"], model: "kimi-k2.5" },
    ],
  },
  // Fast codebase grep - simple tasks
  librarian: {
    fallbackChain: [
      { providers: ["opencode-go"], model: "minimax-m2.7" },
      { providers: ["opencode-go"], model: "glm-5.1" },
    ],
  },
  // Fast codebase search - simple tasks
  explore: {
    fallbackChain: [
      { providers: ["opencode-go"], model: "minimax-m2.7" },
      { providers: ["opencode-go"], model: "glm-5.1" },
    ],
  },
  // Vision/screenshots - complex visual tasks
  "multimodal-looker": {
    fallbackChain: [
      { providers: ["opencode-go"], model: "glm-5.1" },
      { providers: ["opencode-go"], model: "kimi-k2.5" },
      { providers: ["opencode-go"], model: "minimax-m2.7" },
    ],
  },
  // Strategic planner - complex reasoning
  prometheus: {
    fallbackChain: [
      { providers: ["opencode-go"], model: "glm-5.1" },
      { providers: ["opencode-go"], model: "glm-5" },
      { providers: ["opencode-go"], model: "kimi-k2.5" },
    ],
  },
  // Plan review - complex verification
  metis: {
    fallbackChain: [
      { providers: ["opencode-go"], model: "glm-5.1" },
      { providers: ["opencode-go"], model: "glm-5" },
      { providers: ["opencode-go"], model: "kimi-k2.5" },
    ],
  },
  // High-accuracy reviewer - complex verification
  momus: {
    fallbackChain: [
      { providers: ["opencode-go"], model: "glm-5.1" },
      { providers: ["opencode-go"], model: "glm-5" },
      { providers: ["opencode-go"], model: "kimi-k2.5" },
    ],
  },
  // Todo orchestrator - medium complexity
  atlas: {
    fallbackChain: [
      { providers: ["opencode-go"], model: "kimi-k2.5" },
      { providers: ["opencode-go"], model: "glm-5.1" },
      { providers: ["opencode-go"], model: "minimax-m2.7" },
    ],
  },
  // Sub-agent - medium complexity
  "sisyphus-junior": {
    fallbackChain: [
      { providers: ["opencode-go"], model: "kimi-k2.5" },
      { providers: ["opencode-go"], model: "glm-5.1" },
      { providers: ["opencode-go"], model: "minimax-m2.7" },
    ],
  },
};

/**
 * Category requirements - OpenCode Go only
 * Complex: glm-5.1
 * Simple: minimax-m2.7
 */
export const CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  "visual-engineering": {
    fallbackChain: [
      { providers: ["opencode-go"], model: "glm-5.1" },
      { providers: ["opencode-go"], model: "glm-5" },
      { providers: ["opencode-go"], model: "kimi-k2.5" },
    ],
  },
  ultrabrain: {
    fallbackChain: [
      { providers: ["opencode-go"], model: "glm-5.1" },
      { providers: ["opencode-go"], model: "glm-5" },
      { providers: ["opencode-go"], model: "kimi-k2.5" },
    ],
  },
  deep: {
    fallbackChain: [
      { providers: ["opencode-go"], model: "glm-5.1" },
      { providers: ["opencode-go"], model: "glm-5" },
      { providers: ["opencode-go"], model: "kimi-k2.5" },
    ],
  },
  artistry: {
    fallbackChain: [
      { providers: ["opencode-go"], model: "glm-5.1" },
      { providers: ["opencode-go"], model: "glm-5" },
      { providers: ["opencode-go"], model: "kimi-k2.5" },
    ],
    requiresModel: "glm-5.1",
  },
  quick: {
    fallbackChain: [
      { providers: ["opencode-go"], model: "minimax-m2.7" },
      { providers: ["opencode-go"], model: "glm-5.1" },
      { providers: ["opencode-go"], model: "kimi-k2.5" },
    ],
  },
  "unspecified-low": {
    fallbackChain: [
      { providers: ["opencode-go"], model: "minimax-m2.7" },
      { providers: ["opencode-go"], model: "kimi-k2.5" },
      { providers: ["opencode-go"], model: "glm-5.1" },
    ],
  },
  "unspecified-high": {
    fallbackChain: [
      { providers: ["opencode-go"], model: "glm-5.1" },
      { providers: ["opencode-go"], model: "glm-5" },
      { providers: ["opencode-go"], model: "kimi-k2.5" },
    ],
  },
  writing: {
    fallbackChain: [
      { providers: ["opencode-go"], model: "kimi-k2.5" },
      { providers: ["opencode-go"], model: "glm-5.1" },
      { providers: ["opencode-go"], model: "minimax-m2.7" },
    ],
  },
};
