import type { AgentConfig } from "@opencode-ai/sdk"
import type { CodeReviewerMode } from "./code-reviewer"

export type AgentFactory = (model?: string, options?: Record<string, unknown>) => AgentConfig

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
  | "code-reviewer"

export type OverridableAgentName =
  | "build"
  | BuiltinAgentName

export type AgentName = BuiltinAgentName

export type AgentOverrideConfig = Partial<AgentConfig> & {
  prompt_append?: string
  code_reviewer_mode?: CodeReviewerMode
}

export type AgentOverrides = Partial<Record<OverridableAgentName, AgentOverrideConfig>>
