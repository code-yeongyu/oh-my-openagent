import type { AgentConfig } from "@opencode-ai/sdk";

export type AgentMode = "primary" | "subagent" | "all";

export type AgentFactory = ((model: string) => AgentConfig) & {
  mode: AgentMode;
};

export type AgentCategory =
  | "exploration"
  | "specialist"
  | "advisor"
  | "utility";

export type AgentCost = "FREE" | "CHEAP" | "EXPENSIVE";

export interface DelegationTrigger {
  domain: string;
  trigger: string;
}

export interface AgentPromptMetadata {
  category: AgentCategory;
  cost: AgentCost;
  triggers: DelegationTrigger[];
  useWhen?: string[];
  avoidWhen?: string[];
  dedicatedSection?: string;
  promptAlias?: string;
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

/** Matches GLM VLM variants (e.g., glm-4.6v, glm-5v, glm-5v-turbo). */
const GLM_VISION_MODEL_RE = /glm[\d.-]+v/
export function isGlmVisionModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase();
  return modelName.includes("glm") && GLM_VISION_MODEL_RE.test(modelName);
}

/** Matches GLM-5+ text-only models that support extended thinking.
 *  Excludes VLM variants (glm-5v-turbo, glm-4.6v) which may not support thinking.
 */
export function isGlmThinkingModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase();
  return isGlmModel(model) && !isGlmVisionModel(model) && /^glm[-]?5/.test(modelName);
}

const GLM_SISYPHUS_HARNESS_RE =
  /^(?:glm-5|glm-5[.-]1(?::thinking)?|glm5[.-]1(?::thinking)?|glm-5-turbo|glm5-turbo|glm-5v-turbo|glm5v-turbo)$/;

export function isGlmSisyphusHarnessModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase();
  return GLM_SISYPHUS_HARNESS_RE.test(modelName);
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
