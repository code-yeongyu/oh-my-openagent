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
}

/**
 * Governance level mapping for built-in agents (LIF-62).
 * 
 * Agents that modify files need governance awareness.
 * Read-only agents (explore, librarian, oracle, multimodal-looker) have "none".
 * OmO already has governance in its prompt, so it's "none" here to avoid duplication.
 */
const AGENT_GOVERNANCE_LEVELS: Record<BuiltinAgentName, GovernanceLevel> = {
  OmO: "none",                      // Already has governance in prompt
  oracle: "none",                   // Read-only advisor
  librarian: "none",                // Read-only research
  explore: "none",                  // Read-only exploration
  "frontend-ui-ux-engineer": "full", // File-modifying specialist
  "document-writer": "full",         // File-modifying specialist
  "multimodal-looker": "none",       // Read-only analysis
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
