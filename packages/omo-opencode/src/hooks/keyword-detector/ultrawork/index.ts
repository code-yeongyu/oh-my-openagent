/**
 * Ultrawork message module - routes to appropriate message based on agent/model.
 *
 * Routing:
 * 1. Planner agents (prometheus, plan) → planner.ts
 * 2. GPT models → gpt.ts
 * 3. Gemini models → gemini.ts
 * 4. GLM models → glm.ts
 * 5. Default (Claude, etc.) → default.ts (optimized for Claude series)
 */

export {
  isPlannerAgent,
  isNonOmoAgent,
  isGptModel,
  isGeminiModel,
  isGlmModel,
  getUltraworkSource,
} from "./source-detector";
export type { UltraworkSource } from "./source-detector";
export {
  ULTRAWORK_PLANNER_SECTION,
  getPlannerUltraworkMessage,
} from "./planner";
export { ULTRAWORK_GPT_MESSAGE, getGptUltraworkMessage } from "./gpt";
export { ULTRAWORK_GEMINI_MESSAGE, getGeminiUltraworkMessage } from "./gemini";
export { ULTRAWORK_GLM_MESSAGE, getGlmUltraworkMessage } from "./glm";
export {
  ULTRAWORK_DEFAULT_MESSAGE,
  getDefaultUltraworkMessage,
} from "./default";

import { getUltraworkSource } from "./source-detector";
import { getPlannerUltraworkMessage } from "./planner";
import { getGptUltraworkMessage } from "./gpt";
import { getDefaultUltraworkMessage } from "./default";
import { getGeminiUltraworkMessage } from "./gemini";
import { getGlmUltraworkMessage } from "./glm";

/**
 * Gets the appropriate ultrawork message based on agent and model context.
 */
export function getUltraworkMessage(
  agentName?: string,
  modelID?: string,
): string {
  const source = getUltraworkSource(agentName, modelID);

  switch (source) {
    case "planner":
      return getPlannerUltraworkMessage();
    case "gpt":
      return getGptUltraworkMessage();
    case "gemini":
      return getGeminiUltraworkMessage();
    case "glm":
      return getGlmUltraworkMessage();
    case "default":
    default:
      return getDefaultUltraworkMessage();
  }
}
