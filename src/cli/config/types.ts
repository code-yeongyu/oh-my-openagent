import type { OhMyOpenCodeConfig, AgentOverrides, CategoriesConfig, CategoryConfig, AgentOverrideConfig } from "../../config/schema"

export type EditableOmoaConfig = Partial<OhMyOpenCodeConfig> & Record<string, unknown>

export type ConfigEditorState = {
  config: EditableOmoaConfig
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
  fallback_models?: string[]
}

export type AgentOverridesExtended = Partial<Record<string, AgentConfigExtended>>

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
