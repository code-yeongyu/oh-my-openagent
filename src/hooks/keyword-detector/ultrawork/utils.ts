/**
 * Agent/model detection utilities for ultrawork message routing.
 *
 * Routing logic:
 * 1. Planner agents (prometheus, plan) → planner.ts
 * 2. GPT 5.2 models → gpt5.2.ts
 * 3. Everything else (Claude, etc.) → default.ts
 */

/**
 * Checks if agent is a planner-type agent.
 * Planners don't need ultrawork injection (they ARE the planner).
 */
export function isPlannerAgent(agentName?: string): boolean {
  if (!agentName) return false
  const lowerName = agentName.toLowerCase()
  return lowerName.includes("prometheus") || lowerName.includes("planner") || lowerName === "plan"
}

/**
 * Checks if model is GPT 5.2 series.
 * GPT models benefit from specific prompting patterns.
 */
export function isGptModel(modelID?: string): boolean {
  if (!modelID) return false
  const lowerModel = modelID.toLowerCase()
  return lowerModel.includes("gpt")
}

/** Ultrawork message source type */
export type UltraworkSource = "planner" | "gpt" | "default"

/**
 * Determines which ultrawork message source to use.
 */
export function getUltraworkSource(agentName?: string, modelID?: string): UltraworkSource {
  // Priority 1: Planner agents
  if (isPlannerAgent(agentName)) {
    return "planner"
  }

  // Priority 2: GPT 5.2 models
  if (isGptModel(modelID)) {
    return "gpt"
  }

  // Default: Claude and other models
  return "default"
}
