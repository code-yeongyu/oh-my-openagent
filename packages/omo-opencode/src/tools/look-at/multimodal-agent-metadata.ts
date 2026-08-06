import type { PluginInput } from "@opencode-ai/plugin"
import { MULTIMODAL_LOOKER_AGENT } from "./constants"
import { fetchAvailableModels } from "../../shared/model-availability"
import { log } from "../../shared/logger"
import { readConnectedProvidersCache } from "../../shared/connected-providers-cache"
import { resolveModelPipeline } from "../../shared/model-resolution-pipeline"
import { readVisionCapableModelsCache } from "../../shared/vision-capable-models-cache"
import { buildMultimodalLookerFallbackChain } from "./multimodal-fallback-chain"

type AgentModel = { providerID: string; modelID: string }

type ResolvedAgentMetadata = {
  agentModel?: AgentModel
  agentVariant?: string
}

type AgentInfo = {
  name?: string
  model?: AgentModel
  variant?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getFullModelKey(model: AgentModel): string {
  return `${model.providerID}/${model.modelID}`
}

function isVisionCapableAgentModel(
  agentModel: AgentModel | undefined,
  visionCapableModels: Array<AgentModel>,
): agentModel is AgentModel {
  if (!agentModel) {
    return false
  }

  return visionCapableModels.some((visionCapableModel) =>
    getFullModelKey(visionCapableModel) === getFullModelKey(agentModel),
  )
}

function parseAgentModel(model: string): AgentModel | undefined {
  const [providerID, ...modelIDParts] = model.split("/")
  const modelID = modelIDParts.join("/")
  if (!providerID || modelID.length === 0) {
    return undefined
  }

  return { providerID, modelID }
}

function toAgentInfo(value: unknown): AgentInfo | null {
  if (!isObject(value)) return null
  const name = typeof value["name"] === "string" ? value["name"] : undefined
  const variant = typeof value["variant"] === "string" ? value["variant"] : undefined
  const modelValue = value["model"]
  const model =
    isObject(modelValue) &&
    typeof modelValue["providerID"] === "string" &&
    typeof modelValue["modelID"] === "string"
      ? { providerID: modelValue["providerID"], modelID: modelValue["modelID"] }
      : undefined
  return { name, model, variant }
}

async function resolveRegisteredAgentMetadata(
  ctx: PluginInput,
): Promise<ResolvedAgentMetadata> {
  const agentsResult = await ctx.client.app?.agents?.()
  const agentsRaw = isObject(agentsResult) ? agentsResult["data"] : undefined
  const agents = Array.isArray(agentsRaw) ? agentsRaw.map(toAgentInfo).filter(Boolean) : []

  const matched = agents.find(
    (agent) => agent?.name?.toLowerCase() === MULTIMODAL_LOOKER_AGENT.toLowerCase()
  )

  return {
    agentModel: matched?.model,
    agentVariant: matched?.variant,
  }
}

async function resolveDynamicAgentMetadata(
  ctx: PluginInput,
  visionCapableModels = readVisionCapableModelsCache(),
): Promise<ResolvedAgentMetadata> {
  const fallbackChain = buildMultimodalLookerFallbackChain(visionCapableModels)
  const connectedProviders = readConnectedProvidersCache()
  const availableModels = await fetchAvailableModels(ctx.client, {
    connectedProviders,
  })

  const resolution = resolveModelPipeline({
    constraints: {
      availableModels,
      connectedProviders,
    },
    policy: {
      fallbackChain,
    },
  })

  const agentModel = resolution ? parseAgentModel(resolution.model) : undefined
  if (!isVisionCapableAgentModel(agentModel, visionCapableModels)) {
    return {}
  }

  return {
    agentModel,
    agentVariant: resolution?.variant,
  }
}

function isConfiguredVisionModel(
  configuredModel: AgentModel | undefined,
  dynamicModel: AgentModel | undefined,
): boolean {
  if (!configuredModel || !dynamicModel) {
    return false
  }

  return getFullModelKey(configuredModel) === getFullModelKey(dynamicModel)
}

export async function resolveMultimodalLookerAgentMetadata(
  ctx: PluginInput
): Promise<ResolvedAgentMetadata> {
  try {
    const registeredMetadata = await resolveRegisteredAgentMetadata(ctx)
    const visionCapableModels = readVisionCapableModelsCache()

    if (registeredMetadata.agentModel) {
      const registeredModelIsVisionCapable = isVisionCapableAgentModel(
        registeredMetadata.agentModel,
        visionCapableModels,
      )

      if (registeredModelIsVisionCapable) {
        log("[look_at] Using registered multimodal-looker model (vision-capable)", {
          model: getFullModelKey(registeredMetadata.agentModel),
        })
        return registeredMetadata
      }

      log("[look_at] Registered multimodal-looker model not in vision-capable cache, using it anyway", {
        model: getFullModelKey(registeredMetadata.agentModel),
      })
      return registeredMetadata
    }

    const dynamicMetadata = await resolveDynamicAgentMetadata(ctx, visionCapableModels)
    if (dynamicMetadata.agentModel) {
      log("[look_at] No registered model, using dynamic resolution", {
        model: getFullModelKey(dynamicMetadata.agentModel),
      })
      return dynamicMetadata
    }

    return {}
  } catch (error) {
    log("[look_at] Failed to resolve multimodal-looker model info", error)
    return {}
  }
}
