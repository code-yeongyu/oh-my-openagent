import type { AgentConfig } from "@opencode-ai/sdk"
import type { BuiltinAgentName, AgentOverrideConfig, AgentOverrides, AgentFactory, AgentPromptMetadata } from "./types"
import { createSisyphusAgent } from "./sisyphus"
import { createOracleAgent, ORACLE_PROMPT_METADATA } from "./oracle"
import { createLibrarianAgent, LIBRARIAN_PROMPT_METADATA } from "./librarian"
import { createExploreAgent, EXPLORE_PROMPT_METADATA } from "./explore"
import { createFrontendUiUxEngineerAgent, FRONTEND_PROMPT_METADATA } from "./frontend-ui-ux-engineer"
import { createDocumentWriterAgent, DOCUMENT_WRITER_PROMPT_METADATA } from "./document-writer"
import { createMultimodalLookerAgent, MULTIMODAL_LOOKER_PROMPT_METADATA } from "./multimodal-looker"
import { createKnowledgeCuratorAgent, KNOWLEDGE_CURATOR_PROMPT_METADATA } from "./knowledge-curator"
import { createDebuggerAgent, DEBUGGER_PROMPT_METADATA } from "./debugger"
import { createDevOpsEngineerAgent, DEVOPS_ENGINEER_PROMPT_METADATA } from "./devops-engineer"
import { createProjectManagerAgent, PROJECT_MANAGER_PROMPT_METADATA } from "./project-manager"
import { createTestEngineerAgent, TEST_ENGINEER_PROMPT_METADATA } from "./test-engineer"
import { createCodeReviewerAgent, CODE_REVIEWER_PROMPT_METADATA } from "./code-reviewer"
import { createIncidentCommanderAgent, INCIDENT_COMMANDER_PROMPT_METADATA } from "./incident-commander"
import { createSecurityReviewerAgent, SECURITY_REVIEWER_PROMPT_METADATA } from "./security-reviewer"
import { createCodeIndexerAgent, CODE_INDEXER_PROMPT_METADATA } from "./code-indexer"
import { createPerformanceAnalystAgent, PERFORMANCE_ANALYST_PROMPT_METADATA } from "./performance-analyst"
import { createApiDesignerAgent, API_DESIGNER_PROMPT_METADATA } from "./api-designer"
import { createDBAAgent, DBA_PROMPT_METADATA } from "./dba"
import { createEstimatorAgent, ESTIMATOR_PROMPT_METADATA } from "./estimator"
import type { AvailableAgent } from "./sisyphus-prompt-builder"
import { deepMerge } from "../shared"

type AgentSource = AgentFactory | AgentConfig

const agentSources: Record<BuiltinAgentName, AgentSource> = {
  Sisyphus: createSisyphusAgent,
  oracle: createOracleAgent,
  librarian: createLibrarianAgent,
  explore: createExploreAgent,
  "frontend-ui-ux-engineer": createFrontendUiUxEngineerAgent,
  "document-writer": createDocumentWriterAgent,
  "multimodal-looker": createMultimodalLookerAgent,
  "knowledge-curator": createKnowledgeCuratorAgent,
  "debugger": createDebuggerAgent,
  "devops-engineer": createDevOpsEngineerAgent,
  "project-manager": createProjectManagerAgent,
  "test-engineer": createTestEngineerAgent,
  "code-reviewer": createCodeReviewerAgent,
  "incident-commander": createIncidentCommanderAgent,
  "security-reviewer": createSecurityReviewerAgent,
  "code-indexer": createCodeIndexerAgent,
  "performance-analyst": createPerformanceAnalystAgent,
  "api-designer": createApiDesignerAgent,
  "dba": createDBAAgent,
  "estimator": createEstimatorAgent,
}

/**
 * Metadata for each agent, used to build Sisyphus's dynamic prompt sections
 * (Delegation Table, Tool Selection, Key Triggers, etc.)
 */
const agentMetadata: Partial<Record<BuiltinAgentName, AgentPromptMetadata>> = {
  oracle: ORACLE_PROMPT_METADATA,
  librarian: LIBRARIAN_PROMPT_METADATA,
  explore: EXPLORE_PROMPT_METADATA,
  "frontend-ui-ux-engineer": FRONTEND_PROMPT_METADATA,
  "document-writer": DOCUMENT_WRITER_PROMPT_METADATA,
  "multimodal-looker": MULTIMODAL_LOOKER_PROMPT_METADATA,
  "knowledge-curator": KNOWLEDGE_CURATOR_PROMPT_METADATA,
  "debugger": DEBUGGER_PROMPT_METADATA,
  "devops-engineer": DEVOPS_ENGINEER_PROMPT_METADATA,
  "project-manager": PROJECT_MANAGER_PROMPT_METADATA,
  "test-engineer": TEST_ENGINEER_PROMPT_METADATA,
  "code-reviewer": CODE_REVIEWER_PROMPT_METADATA,
  "incident-commander": INCIDENT_COMMANDER_PROMPT_METADATA,
  "security-reviewer": SECURITY_REVIEWER_PROMPT_METADATA,
  "code-indexer": CODE_INDEXER_PROMPT_METADATA,
  "performance-analyst": PERFORMANCE_ANALYST_PROMPT_METADATA,
  "api-designer": API_DESIGNER_PROMPT_METADATA,
  "dba": DBA_PROMPT_METADATA,
  "estimator": ESTIMATOR_PROMPT_METADATA,
}

function isFactory(source: AgentSource): source is AgentFactory {
  return typeof source === "function"
}

function buildAgent(source: AgentSource, model?: string): AgentConfig {
  return isFactory(source) ? source(model) : source
}

/**
 * Creates OmO-specific environment context (time, timezone, locale).
 * Note: Working directory, platform, and date are already provided by OpenCode's system.ts,
 * so we only include fields that OpenCode doesn't provide to avoid duplication.
 * See: https://github.com/code-yeongyu/oh-my-opencode/issues/379
 */
export function createEnvContext(): string {
  const now = new Date()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const locale = Intl.DateTimeFormat().resolvedOptions().locale

  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  })

  return `
<omo-env>
  Current time: ${timeStr}
  Timezone: ${timezone}
  Locale: ${locale}
</omo-env>`
}

function mergeAgentConfig(
  base: AgentConfig,
  override: AgentOverrideConfig
): AgentConfig {
  const { prompt_append, ...rest } = override
  const merged = deepMerge(base, rest as Partial<AgentConfig>)

  if (prompt_append && merged.prompt) {
    merged.prompt = merged.prompt + "\n" + prompt_append
  }

  return merged
}

export function createBuiltinAgents(
  disabledAgents: BuiltinAgentName[] = [],
  agentOverrides: AgentOverrides = {},
  directory?: string,
  systemDefaultModel?: string
): Record<string, AgentConfig> {
  const result: Record<string, AgentConfig> = {}
  const availableAgents: AvailableAgent[] = []

  for (const [name, source] of Object.entries(agentSources)) {
    const agentName = name as BuiltinAgentName

    if (agentName === "Sisyphus") continue
    if (disabledAgents.includes(agentName)) continue

    const override = agentOverrides[agentName]
    const model = override?.model

    let config = buildAgent(source, model)

    if (agentName === "librarian" && directory && config.prompt) {
      const envContext = createEnvContext()
      config = { ...config, prompt: config.prompt + envContext }
    }

    if (override) {
      config = mergeAgentConfig(config, override)
    }

    result[name] = config

    const metadata = agentMetadata[agentName]
    if (metadata) {
      availableAgents.push({
        name: agentName,
        description: config.description ?? "",
        metadata,
      })
    }
  }

  if (!disabledAgents.includes("Sisyphus")) {
    const sisyphusOverride = agentOverrides["Sisyphus"]
    const sisyphusModel = sisyphusOverride?.model ?? systemDefaultModel

    let sisyphusConfig = createSisyphusAgent(sisyphusModel, availableAgents)

    if (directory && sisyphusConfig.prompt) {
      const envContext = createEnvContext()
      sisyphusConfig = { ...sisyphusConfig, prompt: sisyphusConfig.prompt + envContext }
    }

    if (sisyphusOverride) {
      sisyphusConfig = mergeAgentConfig(sisyphusConfig, sisyphusOverride)
    }

    result["Sisyphus"] = sisyphusConfig
  }

  return result
}
