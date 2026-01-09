export interface ModelCacheState {
  modelContextLimitsCache: Map<string, number>;
  anthropicContext1MEnabled: boolean;
}

export function createModelCacheState(): ModelCacheState {
  return {
    modelContextLimitsCache: new Map<string, number>(),
    anthropicContext1MEnabled: false,
  };
}

export function getModelLimit(
  state: ModelCacheState,
  providerID: string,
  modelID: string
): number | undefined {
  const key = `${providerID}/${modelID}`;
  const cached = state.modelContextLimitsCache.get(key);
  if (cached) return cached;

  if (
    providerID === "anthropic" &&
    state.anthropicContext1MEnabled &&
    modelID.includes("sonnet")
  ) {
    return 1_000_000;
  }
  return undefined;
}
