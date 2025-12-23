import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentRole } from "./types"
import { omoAgent } from "./omo"
import { oracleAgent } from "./oracle"
import { librarianAgent } from "./librarian"
import { exploreAgent } from "./explore"
import { frontendUiUxEngineerAgent } from "./frontend-ui-ux-engineer"
import { documentWriterAgent } from "./document-writer"
import { multimodalLookerAgent } from "./multimodal-looker"
// LIF-62 Phase 4A: Manager and initial specialists
import { implementationSpecialistAgent } from "./implementation-specialist"
import { backendTypescriptAgent } from "./backend-typescript"
import { frontendReactAgent } from "./frontend-react"
// LIF-62 Phase 4B: Language/Platform Specialists
import { backendRustAgent } from "./backend-rust"
import { backendPythonAgent } from "./backend-python"
import { mobileXcodeAgent } from "./mobile-xcode"
import { mobileReactNativeAgent } from "./mobile-react-native"
// LIF-62 Phase 4B: AI/ML Specialists
import { aiMlExpertAgent } from "./ai-ml-expert"
import { agentSpecialistAgent } from "./agent-specialist"
// LIF-62 Phase 4B: Cross-Cutting Specialists
import { securitySpecialistAgent } from "./security-specialist"
import { testSpecialistAgent } from "./test-specialist"
import { optimizationSpecialistAgent } from "./optimization-specialist"
// Documentation specialists
import { docsPublisherAgent } from "./docs-publisher"
// LIF-72: Workflow Specialists
import { productStrategistAgent } from "./product-strategist"
import { strategicPlannerAgent } from "./strategic-planner"
import { taskPlannerAgent } from "./task-planner"
// LIF-73: Context Learning
import { contextLearnerAgent } from "./context-learner"

export const builtinAgents: Record<string, AgentConfig> = {
  OmO: omoAgent,
  oracle: oracleAgent,
  librarian: librarianAgent,
  explore: exploreAgent,
  "frontend-ui-ux-engineer": frontendUiUxEngineerAgent,
  "document-writer": documentWriterAgent,
  "multimodal-looker": multimodalLookerAgent,
  // LIF-62 Phase 4A: Manager and initial specialists
  "implementation-specialist": implementationSpecialistAgent,
  "backend-typescript": backendTypescriptAgent,
  "frontend-react": frontendReactAgent,
  // LIF-62 Phase 4B: Language/Platform Specialists
  "backend-rust": backendRustAgent,
  "backend-python": backendPythonAgent,
  "mobile-xcode": mobileXcodeAgent,
  "mobile-react-native": mobileReactNativeAgent,
  // LIF-62 Phase 4B: AI/ML Specialists
  "ai-ml-expert": aiMlExpertAgent,
  "agent-specialist": agentSpecialistAgent,
  // LIF-62 Phase 4B: Cross-Cutting Specialists
  "security-specialist": securitySpecialistAgent,
  "test-specialist": testSpecialistAgent,
  "optimization-specialist": optimizationSpecialistAgent,
  // Documentation specialists
  "docs-publisher": docsPublisherAgent,
  // LIF-72: Workflow Specialists
  "product-strategist": productStrategistAgent,
  "strategic-planner": strategicPlannerAgent,
  "task-planner": taskPlannerAgent,
  // LIF-73: Context Learning
  "context-learner": contextLearnerAgent,
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
  // Specialists (file-modifying) - Existing
  "frontend-ui-ux-engineer": "specialist",
  "document-writer": "specialist",
  // LIF-62 Phase 4A: Initial Specialists
  "backend-typescript": "specialist",
  "frontend-react": "specialist",
  // LIF-62 Phase 4B: Language/Platform Specialists
  "backend-rust": "specialist",
  "backend-python": "specialist",
  "mobile-xcode": "specialist",
  "mobile-react-native": "specialist",
  // LIF-62 Phase 4B: AI/ML Specialists
  "ai-ml-expert": "specialist",
  "agent-specialist": "specialist",
  // LIF-62 Phase 4B: Cross-Cutting Specialists
  "security-specialist": "specialist",
  "test-specialist": "specialist",
  "optimization-specialist": "specialist",
  // Documentation specialists
  "docs-publisher": "specialist",
  // LIF-72: Workflow Specialists
  "product-strategist": "specialist",
  "strategic-planner": "specialist",
  "task-planner": "specialist",
  // Advisor (read-only)
  oracle: "advisor",
  // Utility (read-only)
  librarian: "utility",
  explore: "utility",
  "multimodal-looker": "utility",
  // LIF-73: Context Learning
  "context-learner": "specialist",
}

export * from "./types"
export { createBuiltinAgents, injectGovernance } from "./utils"
