import type { OhMyOpenCodeConfig, AgentOverrides, CategoriesConfig, CategoryConfig, AgentOverrideConfig } from "../../config/schema"

export type ConfigEditorState = {
  config: OhMyOpenCodeConfig
  modified: boolean
  configPath: string
}

export type ValidationWarning = {
  type: "missing-fallback" | "missing-model"
  agent: string
  message: string
}

export type BashPermissionValue = "ask" | "allow" | "deny"

export type BashPermission = BashPermissionValue | Record<string, BashPermissionValue>

export interface AgentConfigExtended extends AgentOverrideConfig {
  fallback_model?: string
}

export type AgentOverridesExtended = Partial<Record<string, AgentConfigExtended>>

export const AVAILABLE_MODELS = [
  "anthropic/claude-opus-4-5",
  "anthropic/claude-sonnet-4-5",
  "anthropic/claude-sonnet-4-5-thinking",
  "openai/gpt-5.2",
  "openai/gpt-5.1",
  "google/gemini-3-pro",
  "google/gemini-3-flash",
  "github-copilot/gpt-5.2",
  "github-copilot/claude-opus-4-5",
  "opencode/claude-opus-4-5",
  "opencode/gpt-5.2",
  "opencode/glm-4.7-free",
  "zai-coding-plan/glm-4.7",
  "kimi-for-coding/k2p5",
  "mistral/codestral",
  "mistral/codestral-2501",
] as const

export type AvailableModel = (typeof AVAILABLE_MODELS)[number]

export const BUILTIN_CATEGORIES = [
  "visual-engineering",
  "ultrabrain",
  "deep",
  "artistry",
  "quick",
  "unspecified-low",
  "unspecified-high",
  "writing",
] as const

export const AGENT_NAMES = [
  "build",
  "plan",
  "sisyphus",
  "hephaestus",
  "sisyphus-junior",
  "OpenCode-Builder",
  "prometheus",
  "metis",
  "momus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "atlas",
] as const

export type AgentName = (typeof AGENT_NAMES)[number]

export const BASH_COMMANDS = ["rm", "mv", "cp", "*"] as const

export type BashCommand = (typeof BASH_COMMANDS)[number]
