/**
 * Agent/model detection utilities for ultrawork message routing.
 *
 * Routing logic:
 * 1. Planner agents (prometheus, planner-named agents) → planner.ts
 * 2. GPT 5.4 models → gpt5.4.ts
 * 3. Gemini models → gemini.ts
 * 4. GLM models → glm.ts
 * 5. Everything else (Claude, etc.) → default.ts
 */

import { isGeminiModel, isGlmModel, isGptModel } from "../../../agents/types"

/**
 * Checks if agent is a planner-type agent.
 * Planners don't need ultrawork injection (they ARE the planner).
 */
export function isPlannerAgent(agentName?: string): boolean {
  if (!agentName) return false
  const lowerName = agentName.toLowerCase()
  const normalizedName = lowerName.replace(/[_-]+/g, " ").trim()
  return (
    lowerName.includes("prometheus") ||
    lowerName.includes("planner") ||
    normalizedName === "plan agent"
  )
}

/**
 * Checks if agent is a non-OMO agent (e.g., OpenCode's built-in Builder/Plan).
 * Non-OMO agents should not receive keyword injection.
 */
export function isNonOmoAgent(agentName?: string): boolean {
  if (!agentName) return false
  const lowerName = agentName.toLowerCase()
  return lowerName.includes("builder") || lowerName === "plan"
}

export { isGptModel, isGeminiModel, isGlmModel }

/** Ultrawork message source type */
export type UltraworkSource = "planner" | "gpt" | "gemini" | "glm" | "default"

/**
 * Determines which ultrawork message source to use.
 */
export function getUltraworkSource(
  agentName?: string,
  modelID?: string
): UltraworkSource {
  // Priority 1: Planner agents
  if (isPlannerAgent(agentName)) {
    return "planner"
  }

  // Priority 2: GPT models
  if (modelID && isGptModel(modelID)) {
    return "gpt"
  }


  // Priority 3: Gemini models
  if (modelID && isGeminiModel(modelID)) {
    return "gemini"
  }

  if (modelID && isGlmModel(modelID)) {
    return "glm"
  }

  // Default: Claude and other models
  return "default"
}
