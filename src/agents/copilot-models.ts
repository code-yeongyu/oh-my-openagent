/**
 * GitHub Copilot Model Configuration
 *
 * This module defines model mappings for GitHub Copilot LLM subscription.
 * GitHub Copilot provides access to Claude, GPT, and Gemini models through
 * a unified subscription, eliminating the need for separate provider accounts.
 *
 * Model Selection Strategy:
 * - Sisyphus (orchestrator): Claude Opus 4.5 for maximum reasoning capability
 * - Oracle (advisor): GPT-5.2 for strategic analysis and code review
 * - Librarian (research): Claude Sonnet 4.5 for documentation and OSS research
 * - Explore (fast search): Claude Haiku 4.5 for blazing fast codebase exploration
 * - Frontend UI/UX: Gemini 3 Pro for creative UI generation
 * - Document Writer: Gemini 3 Flash for technical documentation
 * - Multimodal Looker: Gemini 3 Flash for PDF/image analysis
 */

/**
 * Model mapping from provider-specific to GitHub Copilot equivalents.
 * All models use the "github-copilot/" prefix for routing through Copilot.
 * 
 * NOTE: GitHub Copilot uses dots for version numbers (e.g., claude-opus-4.5, not claude-opus-4-5)
 */
export const COPILOT_MODEL_MAPPING: Record<string, string> = {
  // Claude models (Anthropic)
  "anthropic/claude-opus-4-5": "github-copilot/claude-opus-4.5",
  "anthropic/claude-sonnet-4-5": "github-copilot/claude-sonnet-4.5",
  "anthropic/claude-sonnet-4": "github-copilot/claude-sonnet-4",
  "anthropic/claude-haiku-4-5": "github-copilot/claude-haiku-4.5",

  // GPT models (OpenAI)
  "openai/gpt-5.2": "github-copilot/gpt-5.2",
  "openai/gpt-5.1": "github-copilot/gpt-5.1",
  "openai/gpt-5": "github-copilot/gpt-5",
  "openai/gpt-5-mini": "github-copilot/gpt-5-mini",
  "openai/o3": "github-copilot/o3",
  "openai/o3-mini": "github-copilot/o3-mini",

  // Gemini models (Google)
  "google/gemini-3-pro-preview": "github-copilot/gemini-3-pro-preview",
  "google/gemini-3-pro": "github-copilot/gemini-3-pro-preview",
  "google/gemini-3-flash-preview": "github-copilot/gemini-3-flash-preview",
  "google/gemini-3-flash": "github-copilot/gemini-3-flash-preview",

  // Free/internal models - map to cheap alternatives
  "opencode/grok-code": "github-copilot/claude-haiku-4.5",
}

/**
 * Default Copilot models for each agent, optimized for their specific use case.
 * These represent the best model choices when using GitHub Copilot subscription.
 * 
 * NOTE: Model names use the exact format from `opencode models github-copilot`
 */
export const COPILOT_AGENT_DEFAULTS: Record<string, string> = {
  // Primary orchestrator - needs maximum reasoning
  Sisyphus: "github-copilot/claude-opus-4.5",

  // Strategic advisor - GPT excels at logical reasoning
  oracle: "github-copilot/gpt-5.2",

  // Research and documentation - Sonnet for thorough analysis
  librarian: "github-copilot/claude-sonnet-4.5",

  // Fast exploration - Haiku for speed, still accurate
  explore: "github-copilot/claude-haiku-4.5",

  // UI/UX specialist - Gemini's creative strength
  "frontend-ui-ux-engineer": "github-copilot/gemini-3-pro-preview",

  // Technical writing - Gemini's prose quality
  "document-writer": "github-copilot/gemini-3-flash-preview",

  // Multimodal analysis - Gemini's vision capability
  "multimodal-looker": "github-copilot/gemini-3-flash-preview",
}

/**
 * Intelligent model switching configuration.
 * Maps task types to optimal model choices for dynamic selection.
 */
export interface ModelSwitchContext {
  /** Current task category */
  taskType: "reasoning" | "creative" | "fast" | "multimodal" | "research" | "code"
  /** Whether deep thinking is needed */
  requiresThinking: boolean
  /** Whether speed is prioritized over quality */
  prioritizeSpeed: boolean
}

/**
 * Suggests the optimal Copilot model based on task context.
 * This enables intelligent model-switching within a session.
 * 
 * NOTE: Model names use the exact format from `opencode models github-copilot`
 */
export function suggestCopilotModel(context: ModelSwitchContext): string {
  const { taskType, requiresThinking, prioritizeSpeed } = context

  // Speed-optimized paths
  if (prioritizeSpeed) {
    switch (taskType) {
      case "multimodal":
        return "github-copilot/gemini-3-flash-preview"
      case "creative":
        return "github-copilot/gemini-3-flash-preview"
      default:
        return "github-copilot/claude-haiku-4.5"
    }
  }

  // Quality-optimized paths
  switch (taskType) {
    case "reasoning":
      return requiresThinking
        ? "github-copilot/claude-opus-4.5"
        : "github-copilot/gpt-5.2"

    case "creative":
      return "github-copilot/gemini-3-pro-preview"

    case "multimodal":
      return "github-copilot/gemini-3-pro-preview"

    case "research":
      return "github-copilot/claude-sonnet-4.5"

    case "code":
      return requiresThinking
        ? "github-copilot/claude-opus-4.5"
        : "github-copilot/claude-sonnet-4.5"

    case "fast":
      return "github-copilot/claude-haiku-4.5"

    default:
      return "github-copilot/claude-sonnet-4.5"
  }
}

/**
 * Converts a provider-specific model to its Copilot equivalent.
 * Returns original if no mapping exists.
 */
export function toCopilotModel(model: string): string {
  return COPILOT_MODEL_MAPPING[model] ?? model
}

/**
 * Checks if a model is a GitHub Copilot model.
 */
export function isCopilotModel(model: string): boolean {
  return model.startsWith("github-copilot/")
}

/**
 * Gets the underlying provider for a Copilot model.
 * Used for applying correct thinking configurations.
 */
export function getCopilotModelProvider(model: string): "anthropic" | "openai" | "google" | null {
  if (!isCopilotModel(model)) return null

  const modelLower = model.toLowerCase()
  if (modelLower.includes("claude")) return "anthropic"
  if (modelLower.includes("gemini")) return "google"
  if (modelLower.includes("gpt") || modelLower.includes("o1") || modelLower.includes("o3")) {
    return "openai"
  }
  return null
}
