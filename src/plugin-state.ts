export interface ModelCacheState {
  modelContextLimitsCache: Map<string, number>;
}

export function createModelCacheState(): ModelCacheState {
  return {
    modelContextLimitsCache: new Map<string, number>(),
  };
}
