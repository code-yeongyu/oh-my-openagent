import type {
  ModelCapabilitiesSnapshot,
  ModelCapabilitiesSnapshotEntry,
} from "./model-capabilities"

export const MODELS_DEV_SOURCE_URL = "https://models.dev/api.json"

type FetchImpl = (input: string) => Promise<Response>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const result = value.filter((item): item is string => typeof item === "string")
  return result.length > 0 ? result : undefined
}

function normalizeSnapshotEntry(rawModelID: string, rawModel: unknown): ModelCapabilitiesSnapshotEntry | undefined {
  if (!isRecord(rawModel)) {
    return undefined
  }

  const id = readString(rawModel.id) ?? rawModelID
  const family = readString(rawModel.family)
  const reasoning = readBoolean(rawModel.reasoning)
  const temperature = readBoolean(rawModel.temperature)
  const toolCall = readBoolean(rawModel.tool_call)

  const rawModalities = isRecord(rawModel.modalities) ? rawModel.modalities : undefined
  const modalitiesInput = readStringArray(rawModalities?.input)
  const modalitiesOutput = readStringArray(rawModalities?.output)
  const modalities = modalitiesInput || modalitiesOutput
    ? {
        ...(modalitiesInput ? { input: modalitiesInput } : {}),
        ...(modalitiesOutput ? { output: modalitiesOutput } : {}),
      }
    : undefined

  const rawLimit = isRecord(rawModel.limit) ? rawModel.limit : undefined
  const limitContext = readNumber(rawLimit?.context)
  const limitInput = readNumber(rawLimit?.input)
  const limitOutput = readNumber(rawLimit?.output)
  const limit = limitContext !== undefined || limitInput !== undefined || limitOutput !== undefined
    ? {
        ...(limitContext !== undefined ? { context: limitContext } : {}),
        ...(limitInput !== undefined ? { input: limitInput } : {}),
        ...(limitOutput !== undefined ? { output: limitOutput } : {}),
      }
    : undefined

  return {
    id,
    ...(family ? { family } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(toolCall !== undefined ? { toolCall } : {}),
    ...(modalities ? { modalities } : {}),
    ...(limit ? { limit } : {}),
  }
}

function mergeSnapshotEntries(
  existing: ModelCapabilitiesSnapshotEntry | undefined,
  incoming: ModelCapabilitiesSnapshotEntry,
): ModelCapabilitiesSnapshotEntry {
  if (!existing) {
    return incoming
  }

  const mergedModalities = existing.modalities || incoming.modalities
    ? {
        ...existing.modalities,
        ...incoming.modalities,
      }
    : undefined
  const mergedLimit = existing.limit || incoming.limit
    ? {
        ...existing.limit,
        ...incoming.limit,
      }
    : undefined

  return {
    ...existing,
    ...incoming,
    ...(mergedModalities ? { modalities: mergedModalities } : {}),
    ...(mergedLimit ? { limit: mergedLimit } : {}),
  }
}

export function buildModelCapabilitiesSnapshotFromModelsDev(raw: unknown): ModelCapabilitiesSnapshot {
  const models: Record<string, ModelCapabilitiesSnapshotEntry> = {}
  const providers = isRecord(raw) ? raw : {}

  for (const providerValue of Object.values(providers)) {
    if (!isRecord(providerValue)) {
      continue
    }

    const providerModels = providerValue.models
    if (!isRecord(providerModels)) {
      continue
    }

    for (const [rawModelID, rawModel] of Object.entries(providerModels)) {
      const normalizedEntry = normalizeSnapshotEntry(rawModelID, rawModel)
      if (!normalizedEntry) {
        continue
      }

      models[normalizedEntry.id.toLowerCase()] = mergeSnapshotEntries(
        models[normalizedEntry.id.toLowerCase()],
        normalizedEntry,
      )
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceUrl: MODELS_DEV_SOURCE_URL,
    models,
  }
}

export async function fetchModelCapabilitiesSnapshot(args: {
  sourceUrl?: string
  fetchImpl?: FetchImpl
} = {}): Promise<ModelCapabilitiesSnapshot> {
  const sourceUrl = args.sourceUrl ?? MODELS_DEV_SOURCE_URL
  const fetchImpl = args.fetchImpl ?? fetch
  const response = await fetchImpl(sourceUrl)

  if (!response.ok) {
    throw new Error(`models.dev fetch failed with ${response.status}`)
  }

  const raw = await response.json()
  const snapshot = buildModelCapabilitiesSnapshotFromModelsDev(raw)
  return {
    ...snapshot,
    sourceUrl,
  }
}
