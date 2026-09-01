import { normalizeSDKResponse } from "../shared"

type ModelDescriptor = {
  providerID: string
  modelID: string
}

type ProviderListClient = {
  provider?: {
    list?: () => Promise<unknown>
  }
}

type ProviderModelMetadata = {
  variants?: Record<string, unknown>
}

type ProviderListEntry = {
  id?: string
  models?: Record<string, ProviderModelMetadata>
}

type ProviderListData = {
  all?: ProviderListEntry[]
}

export async function resolveValidUltraworkVariant(
  client: unknown,
  model: ModelDescriptor | undefined,
  variant: string | undefined,
): Promise<string | undefined> {
  if (!model || !variant) {
    return undefined
  }

  const providerList = (client as ProviderListClient | null | undefined)?.provider?.list
  if (typeof providerList !== "function") {
    return undefined
  }

  const response = await providerList()
  const data = normalizeSDKResponse<ProviderListData>(response, {})
  const providerEntry = data.all?.find((entry) => entry.id === model.providerID)
  const variants = providerEntry?.models?.[model.modelID]?.variants

  if (!variants) {
    return undefined
  }

  return Object.hasOwn(variants, variant) ? variant : undefined
}
