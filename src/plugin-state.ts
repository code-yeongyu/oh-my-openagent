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
