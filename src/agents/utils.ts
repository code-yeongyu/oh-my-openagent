import type { AgentConfig } from "@opencode-ai/sdk"
import type { BuiltinAgentName, AgentOverrideConfig, AgentOverrides, AgentFactory, AgentPromptMetadata } from "./types"
import { createSisyphusAgent } from "./sisyphus"
import { createOracleAgent, ORACLE_PROMPT_METADATA } from "./oracle"
import { createLibrarianAgent, LIBRARIAN_PROMPT_METADATA } from "./librarian"
import { createExploreAgent, EXPLORE_PROMPT_METADATA } from "./explore"
import { createFrontendUiUxEngineerAgent, FRONTEND_PROMPT_METADATA } from "./frontend-ui-ux-engineer"
import { createDocumentWriterAgent, DOCUMENT_WRITER_PROMPT_METADATA } from "./document-writer"
import { createMultimodalLookerAgent, MULTIMODAL_LOOKER_PROMPT_METADATA } from "./multimodal-looker"
import { createMetisAgent } from "./metis"
import { createOrchestratorSisyphusAgent, orchestratorSisyphusAgent } from "./orchestrator-sisyphus"
import { createMomusAgent } from "./momus"
import type { AvailableAgent } from "./sisyphus-prompt-builder"
import { deepMerge } from "../shared"
import { DEFAULT_CATEGORIES } from "../tools/sisyphus-task/constants"
import { resolveMultipleSkills } from "../features/opencode-skill-loader/skill-content"

type AgentSource = AgentFactory | AgentConfig

const agentSources: Record<BuiltinAgentName, AgentSource> = {
  Sisyphus: createSisyphusAgent,
  oracle: createOracleAgent,
  librarian: createLibrarianAgent,
  explore: createExploreAgent,
  "frontend-ui-ux-engineer": createFrontendUiUxEngineerAgent,
  "document-writer": createDocumentWriterAgent,
  "multimodal-looker": createMultimodalLookerAgent,
  "Metis (Plan Consultant)": createMetisAgent,
  "Momus (Plan Reviewer)": createMomusAgent,
  "orchestrator-sisyphus": orchestratorSisyphusAgent,
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
}

function isFactory(source: AgentSource): source is AgentFactory {
  return typeof source === "function"
}

export function buildAgent(source: AgentSource, model?: string): AgentConfig {
  const base = isFactory(source) ? source(model) : source

  const agentWithCategory = base as AgentConfig & { category?: string; skills?: string[] }
  if (agentWithCategory.category) {
    const categoryConfig = DEFAULT_CATEGORIES[agentWithCategory.category]
    if (categoryConfig) {
      if (!base.model) {
        base.model = categoryConfig.model
      }
      if (base.temperature === undefined && categoryConfig.temperature !== undefined) {
        base.temperature = categoryConfig.temperature
      }
    }
  }

  if (agentWithCategory.skills?.length) {
    const { resolved } = resolveMultipleSkills(agentWithCategory.skills)
    if (resolved.size > 0) {
      const skillContent = Array.from(resolved.values()).join("\n\n")
      base.prompt = skillContent + (base.prompt ? "\n\n" + base.prompt : "")
    }
  }

  return base
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
    if (agentName === "orchestrator-sisyphus") continue
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

  if (!disabledAgents.includes("orchestrator-sisyphus")) {
    const orchestratorOverride = agentOverrides["orchestrator-sisyphus"]
    const orchestratorModel = orchestratorOverride?.model
    let orchestratorConfig = createOrchestratorSisyphusAgent({
      model: orchestratorModel,
      availableAgents,
    })

    if (orchestratorOverride) {
      orchestratorConfig = mergeAgentConfig(orchestratorConfig, orchestratorOverride)
    }

    result["orchestrator-sisyphus"] = orchestratorConfig
  }

  return result
}
