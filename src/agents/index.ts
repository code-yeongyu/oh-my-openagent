import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentRole } from "./types"
import { omoAgent } from "./omo"
import { oracleAgent } from "./oracle"
import { librarianAgent } from "./librarian"
import { exploreAgent } from "./explore"
import { frontendUiUxEngineerAgent } from "./frontend-ui-ux-engineer"
import { documentWriterAgent } from "./document-writer"
import { multimodalLookerAgent } from "./multimodal-looker"
// NEW: Import new agents (LIF-62)
import { implementationSpecialistAgent } from "./implementation-specialist"
import { backendTypescriptAgent } from "./backend-typescript"
import { frontendReactAgent } from "./frontend-react"

export const builtinAgents: Record<string, AgentConfig> = {
  OmO: omoAgent,
  oracle: oracleAgent,
  librarian: librarianAgent,
  explore: exploreAgent,
  "frontend-ui-ux-engineer": frontendUiUxEngineerAgent,
  "document-writer": documentWriterAgent,
  "multimodal-looker": multimodalLookerAgent,
  // NEW: Manager and specialist agents (LIF-62)
  "implementation-specialist": implementationSpecialistAgent,
  "backend-typescript": backendTypescriptAgent,
  "frontend-react": frontendReactAgent,
}

/**
 * Agent role registry for multi-layered orchestration (LIF-62).
 * 
 * Maps agent names to their roles for role-based tool configuration.
 * Used by call_omo_agent and background_task tools to apply restrictions.
 * 
 * Role Hierarchy:
 * - team-lead: OmO (can delegate to anyone)
 * - manager: implementation-specialist (can delegate to specialists)
 * - specialist: backend/frontend agents (cannot delegate, modifies files)
 * - advisor: oracle (read-only, strategic guidance)
 * - utility: explore/librarian (read-only, research)
 */
export const AGENT_ROLE_REGISTRY: Record<string, AgentRole> = {
  // Team Lead
  OmO: "team-lead",
  // Manager
  "implementation-specialist": "manager",
  // Specialists (file-modifying)
  "frontend-ui-ux-engineer": "specialist",
  "document-writer": "specialist",
  "backend-typescript": "specialist",
  "frontend-react": "specialist",
  // Advisor (read-only)
  oracle: "advisor",
  // Utility (read-only)
  librarian: "utility",
  explore: "utility",
  "multimodal-looker": "utility",
}

export * from "./types"
export { createBuiltinAgents, injectGovernance } from "./utils"
