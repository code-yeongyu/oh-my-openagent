/**
 * Atlas - Master Orchestrator Agent
 *
 * Orchestrates work via task() to complete ALL tasks in a todo list until fully done.
 *
 * Prompt routing (`getAtlasPromptSource`, evaluated by prompts-core variant order):
 * 1. Claude Opus 4.7       → opus-4-7.md   (literal-following + explicit fan-out push)
 * 2. GPT family            → gpt.md        (shared GPT-family calibration)
 * 3. Gemini family         → gemini.md
 * 4. Kimi K3              → kimi-k3.md    (K3-native; checked first among Kimi)
 * 5. Kimi K2.7             → kimi-k2-7.md  (restrained, outcome-first; checked before generic kimi)
 * 6. Kimi K2.x family      → kimi.md       (Claude-family base + K2.6 thinking-mode calibration)
 * 7. GLM family            → glm.md        (GLM 5.2 calibration)
 * 8. Default (Claude 4.6 family: opus-4-6, sonnet-4-6, haiku-4-5, etc.) → default.md
 */
import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentPromptMetadata } from "../types";
import type { AvailableAgent, AvailableSkill } from "../dynamic-agent-prompt-builder";
import type { CategoryConfig } from "../../config/schema";
declare const MODE: AgentMode;
export type AtlasPromptSource = "default" | "gpt" | "gemini" | "kimi" | "kimi-k3" | "kimi-k2-7" | "opus-4-7" | "glm";
export declare function getAtlasPromptSource(model?: string): AtlasPromptSource;
export interface OrchestratorContext {
    model?: string;
    availableAgents?: AvailableAgent[];
    availableSkills?: AvailableSkill[];
    userCategories?: Record<string, CategoryConfig>;
}
export declare function createAtlasAgent(ctx: OrchestratorContext): AgentConfig;
export declare namespace createAtlasAgent {
    export { MODE as mode };
}
export declare const atlasPromptMetadata: AgentPromptMetadata;
export {};
