import type { AgentConfig } from "@opencode-ai/sdk"
import type {
  BuiltinAgentName,
  AgentOverrideConfig,
  AgentOverrides,
  GovernanceLevel,
} from "./types"
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
import { deepMerge } from "../shared"
import { getGovernanceTemplate } from "../config/governance-template"

const allBuiltinAgents: Record<BuiltinAgentName, AgentConfig> = {
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
}

/**
 * Governance level mapping for built-in agents (LIF-62).
 * 
 * Agents that modify files need governance awareness.
 * Read-only agents (explore, librarian, oracle, multimodal-looker) have "none".
 * OmO already has governance in its prompt, so it's "none" here to avoid duplication.
 */
const AGENT_GOVERNANCE_LEVELS: Record<BuiltinAgentName, GovernanceLevel> = {
  // Team Lead - already has governance
  OmO: "none",                      // Already has governance in prompt
  // Advisor - read-only
  oracle: "none",                   // Read-only advisor
  // Utility - read-only
  librarian: "none",                // Read-only research
  explore: "none",                  // Read-only exploration
  "multimodal-looker": "none",       // Read-only analysis
  // Specialists - file-modifying (existing)
  "frontend-ui-ux-engineer": "full", // File-modifying specialist
  "document-writer": "full",         // File-modifying specialist
  // LIF-62 Phase 4A: Manager and initial specialists
  "implementation-specialist": "full", // Manager - can modify files
  "backend-typescript": "full",        // Specialist - can modify files
  "frontend-react": "full",            // Specialist - can modify files
  // LIF-62 Phase 4B: Language/Platform Specialists
  "backend-rust": "full",              // Specialist - can modify files
  "backend-python": "full",            // Specialist - can modify files
  "mobile-xcode": "full",              // Specialist - can modify files
  "mobile-react-native": "full",       // Specialist - can modify files
  // LIF-62 Phase 4B: AI/ML Specialists
  "ai-ml-expert": "full",              // Specialist - can modify files
  "agent-specialist": "full",          // Specialist - can modify files
  // LIF-62 Phase 4B: Cross-Cutting Specialists
  "security-specialist": "full",       // Specialist - can modify files
  "test-specialist": "full",           // Specialist - can modify files
  "optimization-specialist": "full",   // Specialist - can modify files
}

export function createEnvContext(directory: string): string {
  const now = new Date()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const locale = Intl.DateTimeFormat().resolvedOptions().locale

  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  })

  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  })

  const platform = process.platform as "darwin" | "linux" | "win32" | string

  return `
Here is some useful information about the environment you are running in:
<env>
  Working directory: ${directory}
  Platform: ${platform}
  Today's date: ${dateStr} (NOT 2024, NEVEREVER 2024)
  Current time: ${timeStr}
  Timezone: ${timezone}
  Locale: ${locale}
</env>`
}

function mergeAgentConfig(
  base: AgentConfig,
  override: AgentOverrideConfig
): AgentConfig {
  return deepMerge(base, override as Partial<AgentConfig>)
}

export function createBuiltinAgents(
  disabledAgents: BuiltinAgentName[] = [],
  agentOverrides: AgentOverrides = {},
  directory?: string
): Record<string, AgentConfig> {
  const result: Record<string, AgentConfig> = {}

  for (const [name, config] of Object.entries(allBuiltinAgents)) {
    const agentName = name as BuiltinAgentName

    if (disabledAgents.includes(agentName)) {
      continue
    }

    let finalConfig = config

    // Inject environment context for agents that need it
    if ((agentName === "OmO" || agentName === "librarian") && directory && config.prompt) {
      const envContext = createEnvContext(directory)
      finalConfig = {
        ...config,
        prompt: config.prompt + envContext,
      }
    }

    // LIF-62: Inject governance template for file-modifying agents
    const governanceLevel = AGENT_GOVERNANCE_LEVELS[agentName]
    if (governanceLevel && governanceLevel !== "none") {
      finalConfig = injectGovernance(finalConfig, governanceLevel)
    }

    const override = agentOverrides[agentName]
    if (override) {
      result[name] = mergeAgentConfig(finalConfig, override)
    } else {
      result[name] = finalConfig
    }
  }

  return result
}

// ═══════════════════════════════════════════════════════════════════════════
// Governance Injection (LIF-62)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inject governance template into an agent's prompt based on governance level.
 *
 * This function appends the appropriate governance template to the agent's prompt,
 * enabling file-modifying agents to be aware of governance rules (path validation,
 * changelog tracking, Linear integration, spec-driven workflow).
 *
 * @param config - The agent configuration to inject governance into
 * @param governanceLevel - The level of governance to inject ("full", "minimal", or "none")
 * @returns A new AgentConfig with governance template appended to the prompt
 *
 * @example
 * ```typescript
 * const governedConfig = injectGovernance(frontendAgent, "full")
 * // governedConfig.prompt now includes governance rules
 * ```
 *
 * @see .cursor/specs/LIF-62-feat-multi-layered-orchestration/plan.md
 */
export function injectGovernance(
  config: AgentConfig,
  governanceLevel: GovernanceLevel
): AgentConfig {
  // Skip injection for agents with no governance requirement
  if (governanceLevel === "none") {
    return config
  }

  const governancePrompt = getGovernanceTemplate(governanceLevel)

  // If no prompt exists, just add the governance template
  if (!config.prompt) {
    return {
      ...config,
      prompt: governancePrompt,
    }
  }

  // Append governance template to existing prompt
  return {
    ...config,
    prompt: config.prompt + "\n\n" + governancePrompt,
  }
}
