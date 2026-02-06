import type { AgentConfig } from "@opencode-ai/sdk"
import type { BuiltinAgentName, AgentOverrideConfig, AgentOverrides, AgentFactory, AgentPromptMetadata } from "./types"
import type { CategoriesConfig, CategoryConfig, GitMasterConfig } from "../config/schema"
import { createSisyphusAgent } from "./sisyphus"
import { createOracleAgent, ORACLE_PROMPT_METADATA } from "./oracle"
import { createLibrarianAgent, LIBRARIAN_PROMPT_METADATA } from "./librarian"
import { createExploreAgent, EXPLORE_PROMPT_METADATA } from "./explore"
import { createMultimodalLookerAgent, MULTIMODAL_LOOKER_PROMPT_METADATA } from "./multimodal-looker"
import { createMetisAgent, metisPromptMetadata } from "./metis"
import { createAtlasAgent, atlasPromptMetadata } from "./atlas"
import { createMomusAgent, momusPromptMetadata } from "./momus"
import { createHephaestusAgent } from "./hephaestus"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "./dynamic-agent-prompt-builder"
import { deepMerge, fetchAvailableModels, resolveModelPipeline, AGENT_MODEL_REQUIREMENTS, readConnectedProvidersCache, isModelAvailable, isAnyFallbackModelAvailable, isAnyProviderConnected, migrateAgentConfig } from "../shared"
import { DEFAULT_CATEGORIES, CATEGORY_DESCRIPTIONS } from "../tools/delegate-task/constants"
import { resolveMultipleSkills } from "../features/opencode-skill-loader/skill-content"
import { createBuiltinSkills } from "../features/builtin-skills"
import type { LoadedSkill, SkillScope } from "../features/opencode-skill-loader/types"
import type { BrowserAutomationProvider } from "../config/schema"

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
  atlas: createAtlasAgent as unknown as AgentFactory,
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

function isFactory(source: AgentSource): source is AgentFactory {
  return typeof source === "function"
}

export function buildAgent(
  source: AgentSource,
  model: string,
  categories?: CategoriesConfig,
  gitMasterConfig?: GitMasterConfig,
  browserProvider?: BrowserAutomationProvider,
  disabledSkills?: Set<string>
): AgentConfig {
  const base = isFactory(source) ? source(model) : source
  const categoryConfigs: Record<string, CategoryConfig> = categories
    ? { ...DEFAULT_CATEGORIES, ...categories }
    : DEFAULT_CATEGORIES

  const agentWithCategory = base as AgentConfig & { category?: string; skills?: string[]; variant?: string }
  if (agentWithCategory.category) {
    const categoryConfig = categoryConfigs[agentWithCategory.category]
    if (categoryConfig) {
      if (!base.model) {
        base.model = categoryConfig.model
      }
      if (base.temperature === undefined && categoryConfig.temperature !== undefined) {
        base.temperature = categoryConfig.temperature
      }
      if (base.variant === undefined && categoryConfig.variant !== undefined) {
        base.variant = categoryConfig.variant
      }
    }
  }

  if (agentWithCategory.skills?.length) {
    const { resolved } = resolveMultipleSkills(agentWithCategory.skills, { gitMasterConfig, browserProvider, disabledSkills })
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

  const dateStr = now.toLocaleDateString(locale, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  })

  const timeStr = now.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  })

  return `
<omo-env>
  Current date: ${dateStr}
  Current time: ${timeStr}
  Timezone: ${timezone}
  Locale: ${locale}
</omo-env>`
}

/**
 * Expands a category reference from an agent override into concrete config properties.
 * Category properties are applied unconditionally (overwriting factory defaults),
 * because the user's chosen category should take priority over factory base values.
 * Direct override properties applied later via mergeAgentConfig() will supersede these.
 */
function applyCategoryOverride(
  config: AgentConfig,
  categoryName: string,
  mergedCategories: Record<string, CategoryConfig>
): AgentConfig {
  const categoryConfig = mergedCategories[categoryName]
  if (!categoryConfig) return config

  const result = { ...config } as AgentConfig & Record<string, unknown>
  if (categoryConfig.model) result.model = categoryConfig.model
  if (categoryConfig.variant !== undefined) result.variant = categoryConfig.variant
  if (categoryConfig.temperature !== undefined) result.temperature = categoryConfig.temperature
  if (categoryConfig.reasoningEffort !== undefined) result.reasoningEffort = categoryConfig.reasoningEffort
  if (categoryConfig.textVerbosity !== undefined) result.textVerbosity = categoryConfig.textVerbosity
  if (categoryConfig.thinking !== undefined) result.thinking = categoryConfig.thinking
  if (categoryConfig.top_p !== undefined) result.top_p = categoryConfig.top_p
  if (categoryConfig.maxTokens !== undefined) result.maxTokens = categoryConfig.maxTokens

  return result as AgentConfig
}

function applyModelResolution(input: {
  uiSelectedModel?: string
  userModel?: string
  requirement?: { fallbackChain?: { providers: string[]; model: string; variant?: string }[] }
  availableModels: Set<string>
  systemDefaultModel?: string
}) {
  const { uiSelectedModel, userModel, requirement, availableModels, systemDefaultModel } = input
  return resolveModelPipeline({
    intent: { uiSelectedModel, userModel },
    constraints: { availableModels },
    policy: { fallbackChain: requirement?.fallbackChain, systemDefaultModel },
  })
}

function getFirstFallbackModel(requirement?: {
  fallbackChain?: { providers: string[]; model: string; variant?: string }[]
}) {
  const entry = requirement?.fallbackChain?.[0]
  if (!entry || entry.providers.length === 0) return undefined
  return {
    model: `${entry.providers[0]}/${entry.model}`,
    provenance: "provider-fallback" as const,
    variant: entry.variant,
  }
}

function applyEnvironmentContext(config: AgentConfig, directory?: string): AgentConfig {
  if (!directory || !config.prompt) return config
  const envContext = createEnvContext()
  return { ...config, prompt: config.prompt + envContext }
}

function applyOverrides(
  config: AgentConfig,
  override: AgentOverrideConfig | undefined,
  mergedCategories: Record<string, CategoryConfig>
): AgentConfig {
  let result = config
  const overrideCategory = (override as Record<string, unknown> | undefined)?.category as string | undefined
  if (overrideCategory) {
    result = applyCategoryOverride(result, overrideCategory, mergedCategories)
  }

  if (override) {
    result = mergeAgentConfig(result, override)
  }

  return result
}

function mergeAgentConfig(
  base: AgentConfig,
  override: AgentOverrideConfig
): AgentConfig {
  const migratedOverride = migrateAgentConfig(override as Record<string, unknown>) as AgentOverrideConfig
  const { prompt_append, ...rest } = migratedOverride
  const merged = deepMerge(base, rest as Partial<AgentConfig>)

  if (prompt_append && merged.prompt) {
    merged.prompt = merged.prompt + "\n" + prompt_append
  }

  return merged
}

function mapScopeToLocation(scope: SkillScope): AvailableSkill["location"] {
  if (scope === "user" || scope === "opencode") return "user"
  if (scope === "project" || scope === "opencode-project") return "project"
  return "plugin"
}

export async function createBuiltinAgents(
  disabledAgents: string[] = [],
  agentOverrides: AgentOverrides = {},
  directory?: string,
  systemDefaultModel?: string,
  categories?: CategoriesConfig,
  gitMasterConfig?: GitMasterConfig,
  discoveredSkills: LoadedSkill[] = [],
  client?: any,
  browserProvider?: BrowserAutomationProvider,
  uiSelectedModel?: string,
  disabledSkills?: Set<string>
): Promise<Record<string, AgentConfig>> {
  const connectedProviders = readConnectedProvidersCache()
  // IMPORTANT: Do NOT pass client to fetchAvailableModels during plugin initialization.
  // This function is called from config handler, and calling client API causes deadlock.
  // See: https://github.com/code-yeongyu/oh-my-opencode/issues/1301
  const availableModels = await fetchAvailableModels(undefined, {
    connectedProviders: connectedProviders ?? undefined,
  })
  const isFirstRunNoCache =
    availableModels.size === 0 && (!connectedProviders || connectedProviders.length === 0)

  const result: Record<string, AgentConfig> = {}
  const availableAgents: AvailableAgent[] = []

  const mergedCategories = categories
    ? { ...DEFAULT_CATEGORIES, ...categories }
    : DEFAULT_CATEGORIES

  const availableCategories: AvailableCategory[] = Object.entries(mergedCategories).map(([name]) => ({
    name,
    description: categories?.[name]?.description ?? CATEGORY_DESCRIPTIONS[name] ?? "General tasks",
  }))

  const builtinSkills = createBuiltinSkills({ browserProvider, disabledSkills })
  const builtinSkillNames = new Set(builtinSkills.map(s => s.name))

  const builtinAvailable: AvailableSkill[] = builtinSkills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    location: "plugin" as const,
  }))

  const discoveredAvailable: AvailableSkill[] = discoveredSkills
    .filter(s => !builtinSkillNames.has(s.name))
    .map((skill) => ({
      name: skill.name,
      description: skill.definition.description ?? "",
      location: mapScopeToLocation(skill.scope),
    }))

  const availableSkills: AvailableSkill[] = [...builtinAvailable, ...discoveredAvailable]

  // Collect general agents first (for availableAgents), but don't add to result yet
  const pendingAgentConfigs: Map<string, AgentConfig> = new Map()

   for (const [name, source] of Object.entries(agentSources)) {
     const agentName = name as BuiltinAgentName

     if (agentName === "sisyphus") continue
     if (agentName === "hephaestus") continue
     if (agentName === "atlas") continue
     if (disabledAgents.some((name) => name.toLowerCase() === agentName.toLowerCase())) continue

     const override = agentOverrides[agentName]
       ?? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
     const requirement = AGENT_MODEL_REQUIREMENTS[agentName]

     // Check if agent requires a specific model
     if (requirement?.requiresModel && availableModels) {
       if (!isModelAvailable(requirement.requiresModel, availableModels)) {
         continue
       }
     }

     const isPrimaryAgent = isFactory(source) && source.mode === "primary"

    const resolution = applyModelResolution({
      uiSelectedModel: isPrimaryAgent ? uiSelectedModel : undefined,
      userModel: override?.model,
      requirement,
      availableModels,
      systemDefaultModel,
    })
    if (!resolution) continue
    const { model, variant: resolvedVariant } = resolution

    let config = buildAgent(source, model, mergedCategories, gitMasterConfig, browserProvider, disabledSkills)
    
    // Apply resolved variant from model fallback chain
    if (resolvedVariant) {
      config = { ...config, variant: resolvedVariant }
    }

    // Expand override.category into concrete properties (higher priority than factory/resolved)
    const overrideCategory = (override as Record<string, unknown> | undefined)?.category as string | undefined
    if (overrideCategory) {
      config = applyCategoryOverride(config, overrideCategory, mergedCategories)
    }

    if (agentName === "librarian") {
      config = applyEnvironmentContext(config, directory)
    }

    config = applyOverrides(config, override, mergedCategories)

    // Store for later - will be added after sisyphus and hephaestus
    pendingAgentConfigs.set(name, config)

    const metadata = agentMetadata[agentName]
    if (metadata) {
      availableAgents.push({
        name: agentName,
        description: config.description ?? "",
        metadata,
      })
    }
  }

   const sisyphusOverride = agentOverrides["sisyphus"]
   const sisyphusRequirement = AGENT_MODEL_REQUIREMENTS["sisyphus"]
   const hasSisyphusExplicitConfig = sisyphusOverride !== undefined
   const meetsSisyphusAnyModelRequirement =
     !sisyphusRequirement?.requiresAnyModel ||
     hasSisyphusExplicitConfig ||
     isFirstRunNoCache ||
     isAnyFallbackModelAvailable(sisyphusRequirement.fallbackChain, availableModels)

   if (!disabledAgents.includes("sisyphus") && meetsSisyphusAnyModelRequirement) {
    let sisyphusResolution = applyModelResolution({
      uiSelectedModel,
      userModel: sisyphusOverride?.model,
      requirement: sisyphusRequirement,
      availableModels,
      systemDefaultModel,
    })

    if (isFirstRunNoCache && !sisyphusOverride?.model && !uiSelectedModel) {
      sisyphusResolution = getFirstFallbackModel(sisyphusRequirement)
    }

    if (sisyphusResolution) {
      const { model: sisyphusModel, variant: sisyphusResolvedVariant } = sisyphusResolution

      let sisyphusConfig = createSisyphusAgent(
        sisyphusModel,
        availableAgents,
        undefined,
        availableSkills,
        availableCategories
      )

      if (sisyphusResolvedVariant) {
        sisyphusConfig = { ...sisyphusConfig, variant: sisyphusResolvedVariant }
      }

      sisyphusConfig = applyOverrides(sisyphusConfig, sisyphusOverride, mergedCategories)
      sisyphusConfig = applyEnvironmentContext(sisyphusConfig, directory)

      result["sisyphus"] = sisyphusConfig
    }
   }

  if (!disabledAgents.includes("hephaestus")) {
    const hephaestusOverride = agentOverrides["hephaestus"]
    const hephaestusRequirement = AGENT_MODEL_REQUIREMENTS["hephaestus"]
    const hasHephaestusExplicitConfig = hephaestusOverride !== undefined

    const hasRequiredProvider =
      !hephaestusRequirement?.requiresProvider ||
      hasHephaestusExplicitConfig ||
      isFirstRunNoCache ||
      isAnyProviderConnected(hephaestusRequirement.requiresProvider, availableModels)

    if (hasRequiredProvider) {
      let hephaestusResolution = applyModelResolution({
        userModel: hephaestusOverride?.model,
        requirement: hephaestusRequirement,
        availableModels,
        systemDefaultModel,
      })

      if (isFirstRunNoCache && !hephaestusOverride?.model) {
        hephaestusResolution = getFirstFallbackModel(hephaestusRequirement)
      }

      if (hephaestusResolution) {
        const { model: hephaestusModel, variant: hephaestusResolvedVariant } = hephaestusResolution

        let hephaestusConfig = createHephaestusAgent(
          hephaestusModel,
          availableAgents,
          undefined,
          availableSkills,
          availableCategories
        )

        hephaestusConfig = { ...hephaestusConfig, variant: hephaestusResolvedVariant ?? "medium" }

        const hepOverrideCategory = (hephaestusOverride as Record<string, unknown> | undefined)?.category as string | undefined
        if (hepOverrideCategory) {
          hephaestusConfig = applyCategoryOverride(hephaestusConfig, hepOverrideCategory, mergedCategories)
        }

        if (directory && hephaestusConfig.prompt) {
          const envContext = createEnvContext()
          hephaestusConfig = { ...hephaestusConfig, prompt: hephaestusConfig.prompt + envContext }
        }

        if (hephaestusOverride) {
          hephaestusConfig = mergeAgentConfig(hephaestusConfig, hephaestusOverride)
        }

        result["hephaestus"] = hephaestusConfig
      }
    }
   }

   // Add pending agents after sisyphus and hephaestus to maintain order
   for (const [name, config] of pendingAgentConfigs) {
     result[name] = config
   }

    if (!disabledAgents.includes("atlas")) {
      const orchestratorOverride = agentOverrides["atlas"]
      const atlasRequirement = AGENT_MODEL_REQUIREMENTS["atlas"]

      const atlasResolution = applyModelResolution({
        uiSelectedModel,
        userModel: orchestratorOverride?.model,
        requirement: atlasRequirement,
        availableModels,
        systemDefaultModel,
      })
    
    if (atlasResolution) {
      const { model: atlasModel, variant: atlasResolvedVariant } = atlasResolution

      let orchestratorConfig = createAtlasAgent({
        model: atlasModel,
        availableAgents,
        availableSkills,
        userCategories: categories,
      })

      if (atlasResolvedVariant) {
        orchestratorConfig = { ...orchestratorConfig, variant: atlasResolvedVariant }
      }

      orchestratorConfig = applyOverrides(orchestratorConfig, orchestratorOverride, mergedCategories)

      result["atlas"] = orchestratorConfig
    }
   }

   return result
 }
