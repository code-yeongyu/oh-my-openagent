import type { AgentConfig } from "@opencode-ai/sdk"

export type AgentFactory = (model?: string) => AgentConfig

export function isGptModel(model: string): boolean {
  return model.startsWith("openai/") || model.startsWith("github-copilot/gpt-")
}

export type BuiltinAgentName =
  | "Sisyphus"
  | "oracle"
  | "librarian"
  | "explore"
  | "frontend-ui-ux-engineer"
  | "document-writer"
  | "multimodal-looker"

export type OverridableAgentName =
  | "build"
  | BuiltinAgentName

export type AgentName = BuiltinAgentName

export type AgentOverrideConfig = Partial<AgentConfig>

export type AgentOverrides = Partial<Record<OverridableAgentName, AgentOverrideConfig>>
