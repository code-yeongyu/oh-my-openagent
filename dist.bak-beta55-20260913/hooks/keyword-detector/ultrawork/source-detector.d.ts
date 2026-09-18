/**
 * Agent/model detection utilities for ultrawork message routing.
 *
 * Routing logic:
 * 1. Planner agents (prometheus, plan) → planner.ts
 * 3. Gemini models → gemini.ts
 * 4. GLM models → glm.ts
 * 5. Everything else (Claude, etc.) → default.ts
 */
import { isGeminiModel, isGlmModel, isGptModel } from "../../../agents/types";
/**
 * Checks if agent is a planner-type agent.
 * Planners don't need ultrawork injection (they ARE the planner).
 */
export declare function isPlannerAgent(agentName?: string): boolean;
/**
 * Checks if agent is a non-OMO agent (e.g., OpenCode's built-in Builder/Plan).
 * Non-OMO agents should not receive keyword injection.
 */
export declare function isNonOmoAgent(agentName?: string): boolean;
export { isGptModel, isGeminiModel, isGlmModel };
/** Ultrawork message source type */
export type UltraworkSource = "planner" | "gpt" | "gemini" | "glm" | "default";
/**
 * Determines which ultrawork message source to use.
 */
export declare function getUltraworkSource(agentName?: string, modelID?: string): UltraworkSource;
