export type VisionCapableModel = {
  providerID: string
  modelID: string
}

export interface ModelCacheState {
  modelContextLimitsCache: Map<string, number>;
  visionCapableModelsCache?: Map<string, VisionCapableModel>;
  anthropicContext1MEnabled: boolean;
}

export function createModelCacheState(): ModelCacheState {
  return {
    modelContextLimitsCache: new Map<string, number>(),
    visionCapableModelsCache: new Map<string, VisionCapableModel>(),
    anthropicContext1MEnabled: false,
  };
}
