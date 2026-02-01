/**
 * Ultrawork message module - routes to appropriate message based on agent/model.
 *
 * Routing:
 * 1. Planner agents (prometheus, plan) → planner.ts
 * 2. GPT 5.2 models → gpt5.2.ts
 * 3. Default (Claude, etc.) → default.ts (optimized for Claude series)
 */

export { isPlannerAgent, isGptModel, getUltraworkSource } from "./utils"
export type { UltraworkSource } from "./utils"
export { ULTRAWORK_PLANNER_SECTION, getPlannerUltraworkMessage } from "./planner"
export { ULTRAWORK_GPT_MESSAGE, getGptUltraworkMessage } from "./gpt5.2"
export { ULTRAWORK_DEFAULT_MESSAGE, getDefaultUltraworkMessage } from "./default"

import { getUltraworkSource } from "./utils"
import { getPlannerUltraworkMessage } from "./planner"
import { getGptUltraworkMessage } from "./gpt5.2"
import { getDefaultUltraworkMessage } from "./default"

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
    case "default":
    default:
      return getDefaultUltraworkMessage()
  }
}
