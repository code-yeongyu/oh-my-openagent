export type ProviderModel = {
  readonly providerID: string
  readonly modelID: string
}

export function canonicalizeProviderID(providerID: string | undefined): string | undefined {
  const canonical = providerID?.trim().toLowerCase()
  return canonical || undefined
}

export function resolveEffectiveProviderModel(
  explicitModel: ProviderModel | undefined,
  inheritedModel: ProviderModel | undefined,
): ProviderModel | undefined {
  return explicitModel ?? inheritedModel
}

export function canUseCallOmoAgent(
  explicitModel: ProviderModel | undefined,
  inheritedModel?: ProviderModel,
): boolean {
  const effectiveModel = resolveEffectiveProviderModel(explicitModel, inheritedModel)
  return canonicalizeProviderID(effectiveModel?.providerID) !== "anthropic"
}
