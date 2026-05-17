import type { AgentConfig } from "@opencode-ai/sdk";

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
export type AgentCategory =
  | "exploration"
  | "specialist"
  | "advisor"
  | "utility";

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

function extractModelName(model: string): string {
  return model.includes("/") ? (model.split("/").pop() ?? model) : model;
}

export function isGptModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase();
  return modelName.includes("gpt");
}

const GPT_NATIVE_SISYPHUS_RE = /gpt-5[.-](?:[4-9]|\d{2,})/i;

export function isGptNativeSisyphusModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase();
  return GPT_NATIVE_SISYPHUS_RE.test(modelName);
}

export function isGpt5_5Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase();
  return modelName.includes("gpt-5.5") || modelName.includes("gpt-5-5");
}

export function isGpt5_3CodexModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase();
  return modelName.includes("gpt-5.3-codex") || modelName.includes("gpt-5-3-codex");
}

export function isGpt5_2Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase();
  return modelName.includes("gpt-5.2") || modelName.includes("gpt-5-2");
}

export function isClaudeOpus47Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase().replaceAll(".", "-");
  return modelName.includes("claude-opus-4-7");
}

/**
 * Kimi K2.x model detection (K2.5 / K2.6 family).
 *
 * Matches model IDs containing any of:
 *   - "kimi" (provider/family signal — kimi-k2.6, moonshotai/Kimi-K2.6, etc.)
 *   - "k2p5" / "k2-p5" / "k2.p5"
 *   - "k2p6" / "k2-p6" / "k2.p6"
 *
 * Match is case-insensitive on the model name (last path segment).
 */
export function isKimiK2Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase();
  if (modelName.includes("kimi")) return true;
  if (/k2[-.]?p[56]/.test(modelName)) return true;
  return false;
}

const GEMINI_PROVIDERS = ["google/", "google-vertex/"];

export function isMiniMaxModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase();
  return modelName.includes("minimax");
}

export function isGlmModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase();
  return modelName.includes("glm");
}

export function isGeminiModel(model: string): boolean {
  if (GEMINI_PROVIDERS.some((prefix) => model.startsWith(prefix))) return true;

  if (
    model.startsWith("github-copilot/") &&
    extractModelName(model).toLowerCase().startsWith("gemini")
  )
    return true;

  const modelName = extractModelName(model).toLowerCase();
  return modelName.startsWith("gemini-");
}

export type BuiltinAgentName =
  | "sisyphus"
  | "hephaestus"
  | "oracle"
  | "librarian"
  | "explore"
  | "multimodal-looker"
  | "metis"
  | "momus"
  | "atlas"
  | "sisyphus-junior";

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

export type AgentOverrides = Partial<
  Record<OverridableAgentName, AgentOverrideConfig>
>;
