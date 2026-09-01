export type AgentScope = "user" | "project" | "opencode" | "opencode-project" | "definition-file" | "opencode-config"

export type ClaudeCodeAgentConfig = {
  description?: string
  mode?: "subagent" | "primary" | "all"
  prompt?: string
  tools?: Record<string, boolean>
  model?: string | { providerID: string; modelID: string }
}

export interface AgentFrontmatter {
  name?: string
  description?: string
  model?: string
  tools?: string
  mode?: "subagent" | "primary" | "all"
}

export interface AgentJsonDefinition {
  name: string
  description?: string
  model?: string
  tools?: string | string[]
  mode?: "subagent" | "primary" | "all"
  prompt: string
}

export interface LoadedAgent {
  name: string
  path: string
  config: ClaudeCodeAgentConfig
  scope: AgentScope
}
