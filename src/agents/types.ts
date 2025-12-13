import type { AgentConfig } from "@opencode-ai/sdk"

export type AgentName =
  | "oracle"
  | "librarian"
  | "explore"
  | "frontend-ui-ux-engineer"
  | "document-writer"
  | "multimodal-looker"

export type AgentOverrideConfig = Partial<AgentConfig>

export type AgentOverrides = Partial<Record<AgentName, AgentOverrideConfig>>
