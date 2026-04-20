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

export function applyProviderConfig(params: {
  config: Record<string, unknown>;
  modelCacheState: ModelCacheState;
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

  if (!providers) return;

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

      // Write both dot and dash alias forms to improve cache hits for both 4.6/4-6 and 4.7/4-7 forms
      const primaryKey = `${providerID}/${modelID}`
      modelContextLimitsCache.set(primaryKey, contextLimit)

      // Derive counterpart forms when possible
      let dashForm = modelID
      if (modelID.includes("4.6")) dashForm = modelID.replace("4.6", "4-6")
      else if (modelID.includes("4-6")) dashForm = modelID.replace("4-6", "4.6")
      if (dashForm !== modelID) {
        modelContextLimitsCache.set(`${providerID}/${dashForm}`, contextLimit)
      }

      // Also attempt to preemptively cache the 4.7 forms if a 4.7 variant exists
      let sevenForm = modelID
      if (modelID.includes("4.7")) sevenForm = modelID.replace("4.7", "4-7")
      else if (modelID.includes("4-7")) sevenForm = modelID.replace("4-7", "4.7")
      if (sevenForm !== modelID) {
        modelContextLimitsCache.set(`${providerID}/${sevenForm}`, contextLimit)
      }
    }
  }
}
