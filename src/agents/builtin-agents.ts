import type { AgentConfig } from "@opencode-ai/sdk"
import type { BuiltinAgentName, AgentOverrides, AgentFactory, AgentPromptMetadata } from "./types"
import type { CategoriesConfig, GitMasterConfig } from "../config/schema"
import type { LoadedSkill } from "../features/opencode-skill-loader/types"
import type { BrowserAutomationProvider } from "../config/schema"
import { createMorpheusAgent } from "./morpheus"
import { createOracleAgent, ORACLE_PROMPT_METADATA } from "./merovingian"
import { createLibrarianAgent, LIBRARIAN_PROMPT_METADATA } from "./operator"
import { createExploreAgent, EXPLORE_PROMPT_METADATA } from "./trinity"
import { createMultimodalLookerAgent, MULTIMODAL_LOOKER_PROMPT_METADATA } from "./construct"
import { createSeraphAgent, seraphPromptMetadata } from "./seraph"
import { createAtlasAgent, atlasPromptMetadata } from "./architect"
import { createSmithAgent, smithPromptMetadata } from "./smith"
import { createCipherAgent, CIPHER_PROMPT_METADATA } from "./cipher"

import { createSentinelAgent, SENTINEL_PROMPT_METADATA } from "./sentinel"
import { createZionAgent, ZION_PROMPT_METADATA } from "./zion"
import { createKeymakerAgent } from "./keymaker"
import type { AvailableCategory } from "./dynamic-agent-prompt-builder"
import {
  fetchAvailableModels,
  readConnectedProvidersCache,
  readProviderModelsCache,
} from "../shared"
import { CATEGORY_DESCRIPTIONS } from "../tools/delegate-task/constants"
import { mergeCategories } from "../shared/merge-categories"
import { buildAvailableSkills } from "./builtin-agents/available-skills"
import { collectPendingBuiltinAgents } from "./builtin-agents/general-agents"
import { maybeCreateMorpheusConfig } from "./builtin-agents/sisyphus-agent"
import { maybeCreateKeymakerConfig } from "./builtin-agents/hephaestus-agent"
import { maybeCreateAtlasConfig } from "./builtin-agents/atlas-agent"
import { buildCustomAgentMetadata, parseRegisteredAgentSummaries } from "./custom-agent-summaries"

type AgentSource = AgentFactory | AgentConfig

const agentSources: Record<BuiltinAgentName, AgentSource> = {
  morpheus: createMorpheusAgent,
  keymaker: createKeymakerAgent,
  merovingian: createOracleAgent,
  operator: createLibrarianAgent,
  trinity: createExploreAgent,
  construct: createMultimodalLookerAgent,
  seraph: createSeraphAgent,
  smith: createSmithAgent,
  architect: createAtlasAgent as AgentFactory,
  cipher: createCipherAgent,
  sentinel: createSentinelAgent,
  zion: createZionAgent,
}

/**
 * Metadata for each agent, used to build Morpheus's dynamic prompt sections
 * (Delegation Table, Tool Selection, Key Triggers, etc.)
 */
const agentMetadata: Partial<Record<BuiltinAgentName, AgentPromptMetadata>> = {
  merovingian: ORACLE_PROMPT_METADATA,
  operator: LIBRARIAN_PROMPT_METADATA,
  trinity: EXPLORE_PROMPT_METADATA,
  construct: MULTIMODAL_LOOKER_PROMPT_METADATA,
  seraph: seraphPromptMetadata,
  smith: smithPromptMetadata,
  architect: atlasPromptMetadata,
  cipher: CIPHER_PROMPT_METADATA,
  sentinel: SENTINEL_PROMPT_METADATA,
  zion: ZION_PROMPT_METADATA,
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
  const providerModelsConnected = connectedProviders
    ? (readProviderModelsCache()?.connected ?? [])
    : []
  const mergedConnectedProviders = Array.from(
    new Set([...(connectedProviders ?? []), ...providerModelsConnected])
  )
  // IMPORTANT: Do NOT call OpenCode client APIs during plugin initialization.
  // This function is called from config handler, and calling client API causes deadlock.
  // See: https://github.com/klpanagi/matrixx/issues/1301
  const availableModels = await fetchAvailableModels(undefined, {
    connectedProviders: mergedConnectedProviders.length > 0 ? mergedConnectedProviders : undefined,
  })
  const isFirstRunNoCache =
    availableModels.size === 0 && mergedConnectedProviders.length === 0

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

  const morpheusConfig = maybeCreateMorpheusConfig({
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
  if (morpheusConfig) {
    result["morpheus"] = morpheusConfig
  }

  const keymakerConfig = maybeCreateKeymakerConfig({
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
  if (keymakerConfig) {
    result["keymaker"] = keymakerConfig
  }

  // Add pending agents after morpheus and keymaker to maintain order
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
    result["architect"] = atlasConfig
  }

  return result
}
