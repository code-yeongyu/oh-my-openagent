import type { AgentConfig } from "@opencode-ai/sdk"
import type { BuiltinAgentName, AgentOverrides, AgentPromptMetadata } from "../types"
import type { CategoryConfig } from "../../config/schema"
import type { BrowserAutomationProvider } from "../../config/schema"
import type { AvailableAgent } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS, isModelAvailable } from "../../shared"
import type { ModelRequirement } from "../../shared/model-requirements"
import { buildAgent, isFactory } from "../agent-builder"
import { applyOverrides } from "./agent-overrides"
import { applyEnvironmentContext } from "./environment-context"
import { applyModelResolution, getFirstFallbackModel } from "./model-resolution"

export function collectPendingBuiltinAgents(input: {
  agentSources: Record<BuiltinAgentName, import("../agent-builder").AgentSource>
  agentMetadata: Partial<Record<BuiltinAgentName, AgentPromptMetadata>>
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  directory?: string
  systemDefaultModel?: string
  mergedCategories: Record<string, CategoryConfig>
  browserProvider?: BrowserAutomationProvider
  uiSelectedModel?: string
  availableModels: Set<string>
  disabledSkills?: Set<string>
  useTaskSystem?: boolean
}): { pendingAgentConfigs: Map<string, AgentConfig>; availableAgents: AvailableAgent[] } {
  const {
    agentSources,
    agentMetadata,
    disabledAgents,
    agentOverrides,
    directory,
    systemDefaultModel,
    mergedCategories,
    browserProvider,
    uiSelectedModel,
    availableModels,
    disabledSkills,
  } = input

  const availableAgents: AvailableAgent[] = []
  const pendingAgentConfigs: Map<string, AgentConfig> = new Map()

  for (const [name, source] of Object.entries(agentSources)) {
    const agentName = name as BuiltinAgentName

    if (agentName === "morpheus") continue
    if (agentName === "keymaker") continue
    if (agentName === "architect") continue
    if (disabledAgents.some((name) => name.toLowerCase() === agentName.toLowerCase())) continue

    const override = agentOverrides[agentName]
      ?? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
    const baseRequirement = AGENT_MODEL_REQUIREMENTS[agentName]
    const requirement: ModelRequirement | undefined = override?.fallbackChain
      ? { ...baseRequirement, fallbackChain: override.fallbackChain }
      : baseRequirement

    // Check if agent requires a specific model
    if (requirement?.requiresModel && availableModels) {
      if (!isModelAvailable(requirement.requiresModel, availableModels)) {
        continue
      }
    }

    const isPrimaryAgent = isFactory(source) && source.mode === "primary"

    const resolution = applyModelResolution({
      uiSelectedModel: (isPrimaryAgent && !override?.model) ? uiSelectedModel : undefined,
      userModel: override?.model,
      requirement,
      availableModels,
      systemDefaultModel,
    })
    const fallbackResolution = resolution ?? getFirstFallbackModel(requirement)
    if (!fallbackResolution) continue
    const { model, variant: resolvedVariant } = fallbackResolution

    let config = buildAgent(source, model, mergedCategories, browserProvider, disabledSkills)

    // Apply resolved variant from model fallback chain
    if (resolvedVariant) {
      config = { ...config, variant: resolvedVariant }
    }

    if (agentName === "operator") {
      config = applyEnvironmentContext(config, directory)
    }

    config = applyOverrides(config, override, mergedCategories, directory)

    // Store for later - will be added after morpheus and keymaker
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

  return { pendingAgentConfigs, availableAgents }
}
