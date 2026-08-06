import type { AgentConfig } from "@opencode-ai/sdk"

export const AGENT_CONTROL_KINDS = ["execute", "explore", "plan", "research", "dispatch"] as const

export type AgentControlKind = (typeof AGENT_CONTROL_KINDS)[number]

export type AgentControlDefinition = {
  readonly kind: AgentControlKind
  readonly preset: `agentcontrol-${AgentControlKind}`
  readonly config: AgentConfig
}
