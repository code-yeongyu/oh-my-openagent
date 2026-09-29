import type { Plugin } from "@opencode/plugin"
import type { OhMyOpenCodeConfig } from "./config"
import { createModelCacheState, type ModelCacheState } from "./plugin-state"
import { log } from "./shared"
import { setVisionCapableModelsCache } from "./shared/vision-capable-models-cache"

export type V2ProviderInventory = {
  readonly provider: {
    readonly id: string
    readonly headers?: Record<string, string>
  }
  readonly models: ReadonlyMap<string, {
    readonly capabilities: { readonly input: readonly string[] }
    readonly limit: { readonly context: number }
  }>
}

export function collectTrustedVisionModelsV2(pluginConfig: OhMyOpenCodeConfig): string[] {
  // Mirrors collectTrustedVisionCapableModels in plugin-handlers/config-handler.ts.
  const trusted: string[] = []
  const multimodalLookerOverride = pluginConfig.agents?.["multimodal-looker"]
  const configuredModel = multimodalLookerOverride?.model
  if (typeof configuredModel === "string" && configuredModel.includes("/")) {
    trusted.push(configuredModel)
  }
  return trusted
}

export function populateModelCachesV2(
  inventory: readonly V2ProviderInventory[],
  pluginConfig: OhMyOpenCodeConfig,
  modelCacheState: ModelCacheState,
): void {
  const { modelContextLimitsCache } = modelCacheState
  modelContextLimitsCache.clear()

  const visionCapableModelsCache = modelCacheState.visionCapableModelsCache ?? new Map()
  modelCacheState.visionCapableModelsCache = visionCapableModelsCache
  visionCapableModelsCache.clear()
  setVisionCapableModelsCache(visionCapableModelsCache)

  // V1 read the anthropic-beta header from the merged config file object; V2 reads
  // the live provider inventory, which carries the same headers.
  modelCacheState.anthropicContext1MEnabled = inventory.some(
    (record) => record.provider.id === "anthropic"
      && (record.provider.headers?.["anthropic-beta"]?.includes("context-1m") ?? false),
  )

  for (const record of inventory) {
    const providerID = record.provider.id
    for (const [modelID, model] of record.models) {
      if (model.capabilities.input.includes("image")) {
        visionCapableModelsCache.set(`${providerID}/${modelID}`, { providerID, modelID })
      }
      if (model.limit.context > 0) {
        modelContextLimitsCache.set(`${providerID}/${modelID}`, model.limit.context)
      }
    }
  }

  for (const trustedModelString of collectTrustedVisionModelsV2(pluginConfig)) {
    const slash = trustedModelString.indexOf("/")
    const providerID = trustedModelString.slice(0, slash)
    const modelID = trustedModelString.slice(slash + 1)
    if (!providerID || modelID.length === 0) continue
    const key = `${providerID}/${modelID}`
    if (visionCapableModelsCache.has(key)) continue
    visionCapableModelsCache.set(key, { providerID, modelID })
  }

  log("[v2-models] model caches populated", {
    contextLimits: modelContextLimitsCache.size,
    visionCapable: visionCapableModelsCache.size,
    anthropicContext1MEnabled: modelCacheState.anthropicContext1MEnabled,
  })
}

export function newModelCacheState(): ModelCacheState {
  return createModelCacheState()
}

export async function registerModelV2(
  ctx: Plugin.Context,
  pluginConfig: OhMyOpenCodeConfig,
  modelCacheState: ModelCacheState,
): Promise<void> {
  const providers = await ctx.provider.list()
  const modelOutput = await ctx.model.list()
  const models = modelOutput.data
  const inventory: V2ProviderInventory[] = providers.data.map((provider) => ({
    provider: {
      id: String(provider.id),
      ...(provider.headers ? { headers: { ...provider.headers } } : {}),
    },
    models: new Map(
      models
        .filter((model) => String(model.providerID) === String(provider.id))
        .map((model) => [String(model.id), {
          capabilities: { input: [...model.capabilities.input] },
          limit: { context: model.limit.context },
        }]),
    ),
  }))
  populateModelCachesV2(inventory, pluginConfig, modelCacheState)
}
