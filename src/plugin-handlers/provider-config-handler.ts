import type { ModelCacheState, VisionCapableModel } from "../plugin-state";
import { setVisionCapableModelsCache } from "../shared/vision-capable-models-cache"

const ANTHROPIC_PROVIDER_IDS = [
  "anthropic",
  "google-vertex-anthropic",
  "aws-bedrock-anthropic",
] as const
const ANTHROPIC_CONTEXT_1M_LIMIT = 1_000_000

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

function setProviderContextLimitMinimum(
  cache: Map<string, number>,
  providerIDs: readonly string[],
  minimum: number,
): void {
  for (const providerID of providerIDs) {
    cache.set(providerID, minimum)
  }
}

export function applyProviderConfig(params: {
  config: Record<string, unknown>;
  modelCacheState: ModelCacheState;
}): void {
  const providers = params.config.provider as
    | Record<string, ProviderConfig>
    | undefined;
  const modelContextLimitsCache = params.modelCacheState.modelContextLimitsCache;
  const providerContextLimitMinimumsCache = params.modelCacheState.providerContextLimitMinimumsCache
    ?? new Map<string, number>()
  params.modelCacheState.providerContextLimitMinimumsCache = providerContextLimitMinimumsCache

  modelContextLimitsCache.clear()
  providerContextLimitMinimumsCache.clear()

  const anthropicBeta = providers?.anthropic?.options?.headers?.["anthropic-beta"];
  params.modelCacheState.anthropicContext1MEnabled =
    anthropicBeta?.includes("context-1m") ?? false;
  if (params.modelCacheState.anthropicContext1MEnabled) {
    setProviderContextLimitMinimum(
      providerContextLimitMinimumsCache,
      ANTHROPIC_PROVIDER_IDS,
      ANTHROPIC_CONTEXT_1M_LIMIT,
    )
  }

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

      modelContextLimitsCache.set(
        `${providerID}/${modelID}`,
        contextLimit,
      );
    }
  }
}
