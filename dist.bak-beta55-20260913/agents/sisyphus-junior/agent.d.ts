/**
 * Sisyphus-Junior - Focused Task Executor
 *
 * Executes delegated tasks directly without spawning other agents.
 * Category-spawned executor with domain-specific configurations.
 *
 * Routing:
 * 1. Kimi K3 -> kimi-k3.ts (K3-native executor; reasoning depth with built-in stop conditions)
 * 2. Kimi K2.7 -> kimi-k2-7.ts (restrained, outcome-first)
 * 3. Kimi K2.x -> kimi-k2-6.ts
 * 4. GPT models (openai/*, github-copilot/gpt-*) -> gpt-5-5.ts / gpt-5-4.ts / gpt.ts
 * 5. Gemini models (google/*, google-vertex/*) -> gemini.ts (Gemini-optimized)
 * 6. GLM models -> glm-5-2.ts
 * 7. Default (Claude, etc.) -> default.ts (Claude-optimized)
 */
import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode } from "../types";
import type { AgentOverrideConfig } from "../../config/schema";
declare const MODE: AgentMode;
export declare const SISYPHUS_JUNIOR_DEFAULTS: {
    readonly model: "anthropic/claude-sonnet-5";
    readonly temperature: 0.1;
};
export type SisyphusJuniorPromptSource = "default" | "kimi-k2" | "kimi-k2-7" | "kimi-k3" | "gpt" | "gpt-5-5" | "gpt-5-4" | "gemini" | "glm-5-2";
export declare function getSisyphusJuniorPromptSource(model?: string): SisyphusJuniorPromptSource;
/**
 * Builds the appropriate Sisyphus-Junior prompt based on model.
 */
export declare function buildSisyphusJuniorPrompt(model: string | undefined, useTaskSystem: boolean, promptAppend?: string): string;
export declare function createSisyphusJuniorAgentWithOverrides(override: AgentOverrideConfig | undefined, systemDefaultModel?: string, useTaskSystem?: boolean): AgentConfig;
export declare namespace createSisyphusJuniorAgentWithOverrides {
    export { MODE as mode };
}
export {};
