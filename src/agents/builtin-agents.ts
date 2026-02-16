import type { AgentConfig } from "@opencode-ai/sdk"
import type { BuiltinAgentName, AgentOverrides, AgentFactory, AgentPromptMetadata } from "./types"
import type { CategoriesConfig, GitMasterConfig } from "../config/schema"
import type { LoadedSkill } from "../features/opencode-skill-loader/types"
import type { BrowserAutomationProvider } from "../config/schema"
import { createSisyphusAgent } from "./sisyphus"
import { createOracleAgent, ORACLE_PROMPT_METADATA } from "./oracle"
import { createLibrarianAgent, LIBRARIAN_PROMPT_METADATA } from "./librarian"
import { createExploreAgent, EXPLORE_PROMPT_METADATA } from "./explore"
import { createMultimodalLookerAgent, MULTIMODAL_LOOKER_PROMPT_METADATA } from "./multimodal-looker"
import { createMetisAgent, metisPromptMetadata } from "./metis"
import { createAtlasAgent, atlasPromptMetadata } from "./atlas"
import { createMomusAgent, momusPromptMetadata } from "./momus"
import { createHephaestusAgent } from "./hephaestus"
import type { AvailableCategory } from "./dynamic-agent-prompt-builder"
import { fetchAvailableModels, readConnectedProvidersCache } from "../shared"
import { CATEGORY_DESCRIPTIONS } from "../tools/delegate-task/constants"
import { mergeCategories } from "../shared/merge-categories"
import { buildAvailableSkills } from "./builtin-agents/available-skills"
import { collectPendingBuiltinAgents } from "./builtin-agents/general-agents"
import { maybeCreateSisyphusConfig } from "./builtin-agents/sisyphus-agent"
import { maybeCreateHephaestusConfig } from "./builtin-agents/hephaestus-agent"
import { maybeCreateAtlasConfig } from "./builtin-agents/atlas-agent"
import { buildCustomAgentMetadata, parseRegisteredAgentSummaries } from "./custom-agent-summaries"

type AgentSource = AgentFactory | AgentConfig

const agentSources: Record<BuiltinAgentName, AgentSource> = {
  sisyphus: createSisyphusAgent,
  hephaestus: createHephaestusAgent,
  oracle: createOracleAgent,
  librarian: createLibrarianAgent,
  explore: createExploreAgent,
  "multimodal-looker": createMultimodalLookerAgent,
  metis: createMetisAgent,
  momus: createMomusAgent,
  // Note: Atlas is handled specially in createBuiltinAgents()
  // because it needs OrchestratorContext, not just a model string
  atlas: createAtlasAgent as AgentFactory,
}

/**
 * Metadata for each agent, used to build Sisyphus's dynamic prompt sections
 * (Delegation Table, Tool Selection, Key Triggers, etc.)
 */
const agentMetadata: Partial<Record<BuiltinAgentName, AgentPromptMetadata>> = {
  oracle: ORACLE_PROMPT_METADATA,
  librarian: LIBRARIAN_PROMPT_METADATA,
  explore: EXPLORE_PROMPT_METADATA,
  "multimodal-looker": MULTIMODAL_LOOKER_PROMPT_METADATA,
  metis: metisPromptMetadata,
  momus: momusPromptMetadata,
  atlas: atlasPromptMetadata,
}

export async function createBuiltinAgents(
  disabledAgents: string[] = [],
  agentOverrides: AgentOverrides = {},
  directory?: string,
  systemDefaultModel?: string,
  categories?: CategoriesConfig,
  gitMasterConfig?: GitMasterConfig,
  discoveredSkills: LoadedSkill[] = [],
  customAgentSummaries?: unknown,
  browserProvider?: BrowserAutomationProvider,
  uiSelectedModel?: string,
  disabledSkills?: Set<string>,
  useTaskSystem = false
): Promise<Record<string, AgentConfig>> {
  const connectedProviders = readConnectedProvidersCache()
  // IMPORTANT: Do NOT call OpenCode client APIs during plugin initialization.
  // This function is called from config handler, and calling client API causes deadlock.
  // See: https://github.com/code-yeongyu/oh-my-opencode/issues/1301
  const availableModels = await fetchAvailableModels(undefined, {
    connectedProviders: connectedProviders ?? undefined,
  })
  const isFirstRunNoCache =
    availableModels.size === 0 && (!connectedProviders || connectedProviders.length === 0)

  const result: Record<string, AgentConfig> = {}

  const mergedCategories = mergeCategories(categories)

  const availableCategories: AvailableCategory[] = Object.entries(mergedCategories).map(([name]) => ({
    name,
    description: categories?.[name]?.description ?? CATEGORY_DESCRIPTIONS[name] ?? "General tasks",
  }))

  const availableSkills = buildAvailableSkills(discoveredSkills, browserProvider, disabledSkills)

  // Collect general agents first (for availableAgents), but don't add to result yet
  const { pendingAgentConfigs, availableAgents } = collectPendingBuiltinAgents({
    agentSources,
    agentMetadata,
    disabledAgents,
    agentOverrides,
    directory,
    systemDefaultModel,
    mergedCategories,
    gitMasterConfig,
    browserProvider,
    uiSelectedModel,
    availableModels,
    disabledSkills,
  })

  const registeredAgents = parseRegisteredAgentSummaries(customAgentSummaries)
  const builtinAgentNames = new Set(Object.keys(agentSources).map((name) => name.toLowerCase()))
  const disabledAgentNames = new Set(disabledAgents.map((name) => name.toLowerCase()))

  for (const agent of registeredAgents) {
    const lowerName = agent.name.toLowerCase()
    if (builtinAgentNames.has(lowerName)) continue
    if (disabledAgentNames.has(lowerName)) continue
    if (availableAgents.some((availableAgent) => availableAgent.name.toLowerCase() === lowerName)) continue

    availableAgents.push({
      name: agent.name,
      description: agent.description,
      metadata: buildCustomAgentMetadata(agent.name, agent.description),
    })
  }

  const sisyphusConfig = maybeCreateSisyphusConfig({
    disabledAgents,
    agentOverrides,
    uiSelectedModel,
    availableModels,
    systemDefaultModel,
    isFirstRunNoCache,
    availableAgents,
    availableSkills,
    availableCategories,
    mergedCategories,
    directory,
    userCategories: categories,
    useTaskSystem,
  })
  if (sisyphusConfig) {
    result["sisyphus"] = sisyphusConfig
  }

  const hephaestusConfig = maybeCreateHephaestusConfig({
    disabledAgents,
    agentOverrides,
    availableModels,
    systemDefaultModel,
    isFirstRunNoCache,
    availableAgents,
    availableSkills,
    availableCategories,
    mergedCategories,
    directory,
    useTaskSystem,
  })
  if (hephaestusConfig) {
    result["hephaestus"] = hephaestusConfig
  }

  // Add pending agents after sisyphus and hephaestus to maintain order
  for (const [name, config] of pendingAgentConfigs) {
    result[name] = config
  }

  const atlasConfig = maybeCreateAtlasConfig({
    disabledAgents,
    agentOverrides,
    uiSelectedModel,
    availableModels,
    systemDefaultModel,
    availableAgents,
    availableSkills,
    mergedCategories,
    directory,
    userCategories: categories,
  })
  if (atlasConfig) {
    result["atlas"] = atlasConfig
  }

  return result
}
