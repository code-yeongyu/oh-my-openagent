import type { AgentConfig } from "@opencode-ai/sdk"

export type AgentScope = "user" | "project"

export interface AgentFrontmatter {
  name?: string
  description?: string
  model?: string
  tools?: string | Record<string, boolean>
  mode?: "subagent" | "primary" | "all"
  temperature?: number
  top_p?: number
  color?: string
  permission?: {
    edit?: "ask" | "allow" | "deny"
    bash?: "ask" | "allow" | "deny" | Record<string, "ask" | "allow" | "deny">
    webfetch?: "ask" | "allow" | "deny"
    doom_loop?: "ask" | "allow" | "deny"
    external_directory?: "ask" | "allow" | "deny"
  }
}

export interface LoadedAgent {
  name: string
  path: string
  config: AgentConfig
  scope: AgentScope
}
