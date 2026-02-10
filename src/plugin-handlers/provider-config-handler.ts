import type { ModelCacheState } from "../plugin-state";

type ProviderConfig = {
  options?: { headers?: Record<string, string> };
  models?: Record<string, { limit?: { context?: number } }>;
};

export function applyProviderConfig(params: {
  config: Record<string, unknown>;
  modelCacheState: ModelCacheState;
}): void {
  const providers = params.config.provider as
    | Record<string, ProviderConfig>
    | undefined;

  const anthropicBeta = providers?.anthropic?.options?.headers?.["anthropic-beta"];
  params.modelCacheState.anthropicContext1MEnabled =
    anthropicBeta?.includes("context-1m") ?? false;

  if (!providers) return;

  for (const [providerID, providerConfig] of Object.entries(providers)) {
    const models = providerConfig?.models;
    if (!models) continue;

    for (const [modelID, modelConfig] of Object.entries(models)) {
      const contextLimit = modelConfig?.limit?.context;
      if (!contextLimit) continue;

      params.modelCacheState.modelContextLimitsCache.set(
        `${providerID}/${modelID}`,
        contextLimit,
      );
    }
  }
}
