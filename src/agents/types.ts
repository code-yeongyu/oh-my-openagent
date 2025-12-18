import type { AgentConfig } from "@opencode-ai/sdk"

export type BuiltinAgentName =
  | "OmO"
  | "oracle"
  | "librarian"
  | "explore"
  | "frontend-ui-ux-engineer"
  | "document-writer"
  | "multimodal-looker"

/**
 * Future agent names for multi-layered orchestration (LIF-62).
 * These will be added to BuiltinAgentName when the agents are implemented in Phase 4-6.
 */
export type FutureAgentName =
  | "implementation-specialist"
  | "backend-typescript"
  | "frontend-react"

/**
 * All agent names including future agents.
 * Use this type when you need to reference agents that may not exist yet.
 */
export type AllAgentName = BuiltinAgentName | FutureAgentName

export type OverridableAgentName =
  | "build"
  | BuiltinAgentName

export type AgentName = BuiltinAgentName

export type AgentOverrideConfig = Partial<AgentConfig>

export type AgentOverrides = Partial<Record<OverridableAgentName, AgentOverrideConfig>>

// ═══════════════════════════════════════════════════════════════════════════
// Multi-Layered Agent Orchestration Types (LIF-62)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Agent role classification for multi-layered orchestration.
 * Determines delegation capabilities and governance requirements.
 *
 * Hierarchy:
 * - team-lead: OmO - Can delegate to anyone, full governance
 * - manager: Implementation Specialist - Can delegate to specialists only
 * - specialist: Backend/Frontend - Cannot delegate, full governance
 * - advisor: Oracle - Read-only, strategic guidance
 * - utility: Explore/Librarian - Read-only, research tasks
 */
export type AgentRole =
  | "team-lead"   // OmO: Can delegate to anyone, full governance
  | "manager"     // Implementation Specialist: Can delegate to specialists
  | "specialist"  // Backend/Frontend: Cannot delegate, full governance
  | "advisor"     // Oracle: Read-only, strategic guidance
  | "utility"     // Explore/Librarian: Read-only, research tasks

/**
 * Governance level determines which governance rules are injected into agent prompts.
 *
 * - full: All governance rules (path validation, changelog, Linear, spec)
 * - minimal: Only path validation and changelog
 * - none: No governance injection (read-only agents)
 */
export type GovernanceLevel =
  | "full"     // All governance rules
  | "minimal"  // Basic path validation and changelog only
  | "none"     // No governance injection (read-only agents)

/**
 * Extended agent configuration with role metadata for multi-layered orchestration.
 * Extends the base AgentConfig from @opencode-ai/sdk.
 */
export interface ExtendedAgentConfig extends AgentConfig {
  /** Agent role in the hierarchy */
  role: AgentRole

  /** Whether agent can use task/call_omo_agent tools to delegate */
  canDelegate: boolean

  /** Level of governance rules to inject into prompt */
  governanceLevel: GovernanceLevel

  /** Optional: Maximum delegation depth from this agent (default: role-based) */
  maxDelegationDepth?: number
}

/**
 * Type guard to check if an agent config has role metadata.
 * Used to determine if governance injection should be applied.
 */
export function isExtendedAgentConfig(
  config: AgentConfig | ExtendedAgentConfig
): config is ExtendedAgentConfig {
  return "role" in config && "canDelegate" in config && "governanceLevel" in config
}

/**
 * Agents currently allowed for delegation via call_omo_agent tool.
 * This list will be expanded when new agents are implemented in Phase 4-6.
 */
export const DELEGATABLE_AGENTS = [
  // Utility agents (read-only)
  "explore",
  "librarian",
  "multimodal-looker",
  // Specialist agents (can modify files)
  "frontend-ui-ux-engineer",
  "document-writer",
] as const

export type DelegatableAgentName = (typeof DELEGATABLE_AGENTS)[number]

/**
 * Future delegatable agents for multi-layered orchestration (LIF-62).
 * These will be added to DELEGATABLE_AGENTS when implemented in Phase 4-6.
 */
export const FUTURE_DELEGATABLE_AGENTS = [
  "implementation-specialist",
  "backend-typescript",
  "frontend-react",
] as const

export type FutureDelegatableAgentName = (typeof FUTURE_DELEGATABLE_AGENTS)[number]

/**
 * All delegatable agent names including future agents.
 */
export type AllDelegatableAgentName = DelegatableAgentName | FutureDelegatableAgentName
