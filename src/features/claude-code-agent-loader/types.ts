import type { AgentConfig } from "@opencode-ai/sdk"

export type AgentScope = "user" | "project"

export interface AgentFrontmatter {
  name?: string
  description?: string
  model?: string
  tools?: string
}

export interface LoadedAgent {
  name: string
  path: string
  config: AgentConfig
  scope: AgentScope
}
