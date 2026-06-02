import type { ModelCacheState, VisionCapableModel } from "../plugin-state";
import { setVisionCapableModelsCache } from "../shared/vision-capable-models-cache"

type ProviderConfig = {
  options?: { headers?: Record<string, string> };
  models?: Record<string, ProviderModelConfig>;
};

type ProviderModelConfig = {
  limit?: { context?: number };
  modalities?: {
    input?: string[];
  };
  capabilities?: {
    input?: {
      image?: boolean;
    };
  };
}

function supportsImageInput(modelConfig: ProviderModelConfig | undefined): boolean {
  if (modelConfig?.modalities?.input?.includes("image")) {
    return true
  }

  return modelConfig?.capabilities?.input?.image === true
}

function parseTrustedModel(modelString: string): VisionCapableModel | undefined {
  const [providerID, ...modelIDParts] = modelString.split("/")
  const modelID = modelIDParts.join("/")
  if (!providerID || modelID.length === 0) {
    return undefined
  }
  return { providerID, modelID }
}

export function applyProviderConfig(params: {
  config: Record<string, unknown>;
  modelCacheState: ModelCacheState;
  trustedVisionCapableModels?: string[];
}): void {
  const providers = params.config.provider as
    | Record<string, ProviderConfig>
    | undefined;
  const modelContextLimitsCache = params.modelCacheState.modelContextLimitsCache;

  modelContextLimitsCache.clear()

  const anthropicBeta = providers?.anthropic?.options?.headers?.["anthropic-beta"];
  params.modelCacheState.anthropicContext1MEnabled =
    anthropicBeta?.includes("context-1m") ?? false;

  const visionCapableModelsCache = params.modelCacheState.visionCapableModelsCache
    ?? new Map<string, VisionCapableModel>()
  params.modelCacheState.visionCapableModelsCache = visionCapableModelsCache
  visionCapableModelsCache.clear()
  setVisionCapableModelsCache(visionCapableModelsCache)

  if (providers) {
    for (const [providerID, providerConfig] of Object.entries(providers)) {
      const models = providerConfig?.models;
      if (!models) continue;

      for (const [modelID, modelConfig] of Object.entries(models)) {
        if (supportsImageInput(modelConfig)) {
          visionCapableModelsCache.set(
            `${providerID}/${modelID}`,
            { providerID, modelID },
          )
        }

        const contextLimit = modelConfig?.limit?.context;
        if (!contextLimit) continue;

        modelContextLimitsCache.set(
          `${providerID}/${modelID}`,
          contextLimit,
        );
      }
    }
  }

  for (const trustedModelString of params.trustedVisionCapableModels ?? []) {
    const trustedModel = parseTrustedModel(trustedModelString)
    if (!trustedModel) continue
    const key = `${trustedModel.providerID}/${trustedModel.modelID}`
    if (visionCapableModelsCache.has(key)) continue
    visionCapableModelsCache.set(key, trustedModel)
  }
}
