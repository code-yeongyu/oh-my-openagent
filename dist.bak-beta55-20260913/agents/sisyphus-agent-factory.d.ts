import type { AgentConfig } from "@opencode-ai/sdk";
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "./dynamic-agent-prompt-builder";
import type { AgentMode } from "./types";
declare const MODE: AgentMode;
/**
 * Identifies which prompt body `createSisyphusAgent` bakes for a given model.
 * The whole Sisyphus prompt is model-family-specific and selected here, so this
 * is the single source of truth shared with the runtime reconciler: when the TUI
 * runtime model resolves to a different family than the configured one, the baked
 * body is the wrong family and must be rebuilt (issue #5297/#5316).
 */
export type SisyphusPromptFamily = "kimi-k3" | "kimi-k2-7" | "kimi-k2-6" | "gpt-5-5" | "gpt-5-4" | "claude-fable-5" | "claude-opus-5" | "claude-opus-4-8" | "claude-opus-4-7" | "glm-5-2" | "grok-4" | "fallback";
export declare function resolveSisyphusPromptFamily(model: string): SisyphusPromptFamily;
export declare function createSisyphusAgent(model: string, availableAgents?: AvailableAgent[], availableToolNames?: string[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): AgentConfig;
export declare namespace createSisyphusAgent {
    export { MODE as mode };
}
export {};
