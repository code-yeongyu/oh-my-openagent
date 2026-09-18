import type { AgentConfig } from "@opencode-ai/sdk";
import { isClaudeFable5Model, isClaudeFableOrMythosModel, isClaudeOpus46Model, isClaudeOpus47Model, isClaudeOpus47OrLaterModel, isClaudeOpus48Model, isClaudeOpus5Model, isGeminiModel, isGlmModel, isGptModel, isGrok45Model, isGrok46Model, isKimiK2Model, isKimiK27Model, isKimiK3Model, isMiniMaxModel } from "@oh-my-opencode/model-core";
export { isClaudeFable5Model, isClaudeFableOrMythosModel, isClaudeOpus46Model, isClaudeOpus47Model, isClaudeOpus47OrLaterModel, isClaudeOpus48Model, isClaudeOpus5Model, isGeminiModel, isGlmModel, isGptModel, isGrok45Model, isGrok46Model, isKimiK2Model, isKimiK27Model, isKimiK3Model, isMiniMaxModel, };
/**
 * Anthropic Opus 4.7+, Fable, and Mythos models reject thinking.type "enabled";
 * they require adaptive thinking plus an effort, which OpenCode core derives from
 * the model variant. For those models emit no thinking config and let core drive
 * it (issue #4614; opencode core #31546). All other Claude models keep the
 * explicit enabled-thinking budget.
 */
export declare function buildClaudeThinkingConfig(model: string): {
    thinking: {
        type: "enabled";
        budgetTokens: number;
    };
} | Record<string, never>;
/**
 * Agent mode determines UI model selection behavior:
 * - "primary": Respects user's UI-selected model (sisyphus, atlas)
 * - "subagent": Uses own fallback chain, ignores UI selection (oracle, explore, etc.)
 * - "all": Available in both contexts (OpenCode compatibility)
 */
export type AgentMode = "primary" | "subagent" | "all";
/**
 * Agent factory function with static mode property.
 * Mode is exposed as static property for pre-instantiation access.
 */
export type AgentFactory = ((model: string) => AgentConfig) & {
    mode: AgentMode;
};
/**
 * Agent category for grouping in Sisyphus prompt sections
 */
export type AgentCategory = "exploration" | "specialist" | "advisor" | "utility";
/**
 * Cost classification for Tool Selection table
 */
export type AgentCost = "FREE" | "CHEAP" | "EXPENSIVE";
/**
 * Delegation trigger for Sisyphus prompt's Delegation Table
 */
export interface DelegationTrigger {
    /** Domain of work (e.g., "Frontend UI/UX") */
    domain: string;
    /** When to delegate (e.g., "Visual changes only...") */
    trigger: string;
}
/**
 * Metadata for generating Sisyphus prompt sections dynamically
 * This allows adding/removing agents without manually updating the Sisyphus prompt
 */
export interface AgentPromptMetadata {
    /** Category for grouping in prompt sections */
    category: AgentCategory;
    /** Cost classification for Tool Selection table */
    cost: AgentCost;
    /** Domain triggers for Delegation Table */
    triggers: DelegationTrigger[];
    /** When to use this agent (for detailed sections) */
    useWhen?: string[];
    /** When NOT to use this agent */
    avoidWhen?: string[];
    /** Optional dedicated prompt section (markdown) - for agents like Oracle that have special sections */
    dedicatedSection?: string;
    /** Nickname/alias used in prompt (e.g., "Oracle" instead of "oracle") */
    promptAlias?: string;
    /** Key triggers that should appear in Phase 0 (e.g., "External library mentioned → fire librarian") */
    keyTrigger?: string;
}
export declare function isGptNativeSisyphusModel(model: string): boolean;
export declare function isGpt5_5Model(model: string): boolean;
/** Matches the GPT-5.6 family: gpt-5.6, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna. */
export declare function isGpt5_6Model(model: string): boolean;
/** Matches GPT-6 models, including provider-prefixed and fast-tier IDs. */
export declare function isGpt6Model(model: string): boolean;
export type BuiltinAgentName = "sisyphus" | "hephaestus" | "oracle" | "librarian" | "explore" | "multimodal-looker" | "metis" | "momus" | "atlas" | "sisyphus-junior";
export type OverridableAgentName = "build" | BuiltinAgentName;
export type AgentName = BuiltinAgentName;
export type AgentOverrideConfig = Partial<AgentConfig> & {
    category?: string;
    prompt_append?: string;
    skills?: string[];
    tools?: Record<string, boolean>;
    variant?: string;
    fallback_models?: string | (string | import("../config/schema/fallback-models").FallbackModelObject)[];
};
export type AgentOverrides = Partial<Record<OverridableAgentName, AgentOverrideConfig>>;
