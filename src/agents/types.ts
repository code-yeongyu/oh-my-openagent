import type { AgentConfig } from "@opencode-ai/sdk"

export type AgentFactory = (model?: string) => AgentConfig

export function isGptModel(model: string): boolean {
  return model.startsWith("openai/") || model.startsWith("github-copilot/gpt-")
}

const THINKING_CAPABLE_PROVIDERS = new Set([
  "anthropic",
  "google",
  "google-vertex",
  "amazon-bedrock",
])

export function isThinkingCapableProvider(model: string): boolean {
  const provider = model.split("/")[0]
  return THINKING_CAPABLE_PROVIDERS.has(provider)
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

export type AgentOverrideConfig = Partial<AgentConfig> & {
  prompt_append?: string
}

export type AgentOverrides = Partial<Record<OverridableAgentName, AgentOverrideConfig>>
