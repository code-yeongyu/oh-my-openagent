/**
 * Ultrawork message module - routes to appropriate message based on agent/model.
 *
 * Routing:
 * 1. Planner agents (prometheus, plan) → planner.ts
 * 2. GPT 5.2 models → gpt5.2.ts
 * 3. Default (Claude, etc.) → default.ts (optimized for Claude series)
 */

export { getDefaultUltraworkMessage, ULTRAWORK_DEFAULT_MESSAGE } from "./default"
export { getGptUltraworkMessage, ULTRAWORK_GPT_MESSAGE } from "./gpt5.2"
export { getPlannerUltraworkMessage, ULTRAWORK_PLANNER_SECTION } from "./planner"
export type { UltraworkSource } from "./source-detector"
export { getUltraworkSource, isGptModel, isPlannerAgent } from "./source-detector"

import { getDefaultUltraworkMessage } from "./default"
import { getGptUltraworkMessage } from "./gpt5.2"
import { getPlannerUltraworkMessage } from "./planner"
import { getUltraworkSource } from "./source-detector"

/**
 * Gets the appropriate ultrawork message based on agent and model context.
 */
export function getUltraworkMessage(agentName?: string, modelID?: string): string {
  const source = getUltraworkSource(agentName, modelID)

  switch (source) {
    case "planner":
      return getPlannerUltraworkMessage()
    case "gpt":
      return getGptUltraworkMessage()
    default:
      return getDefaultUltraworkMessage()
  }
}
