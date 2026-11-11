import type { OpencodeClient } from "./types"
import { log } from "../../shared/logger"
import { isRecord } from "../../shared/record-type-guard"
import { parseModelString } from "../../shared/model-string-parser"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"

type ModelListClient = OpencodeClient & {
  model: { list: () => Promise<unknown> }
}

function hasModelList(client: OpencodeClient): client is ModelListClient {
  return "model" in client && isRecord(client.model) && typeof client.model.list === "function"
}

function isModelRow(value: unknown): value is { provider: string; id: string } {
  return isRecord(value) && typeof value.provider === "string" && typeof value.id === "string"
}

function extractModelRows(result: unknown): Array<{ provider: string; id: string }> {
  const rows = Array.isArray(result) ? result : isRecord(result) && Array.isArray(result.data) ? result.data : []
  return rows.filter(isModelRow)
}

function addFromProviderModels(
  out: Set<string>,
  providerID: string,
  models: Array<string | { id?: string }> | undefined,
): void {
  if (!models) return
  for (const item of models) {
    const modelID = typeof item === "string" ? item : item?.id
    if (!modelID) continue
    out.add(`${providerID}/${modelID}`)
  }
}

// model.list supplies IDs, not the provider cache's richer metadata. Merge only exact confirmed
// requests into the latest cache; do not replace provider catalogs or change connection state.
function rememberConfirmedModels(confirmed: readonly string[]): void {
  if (confirmed.length === 0) return
  const cached = connectedProvidersCache.readProviderModelsCache()
  if (!cached) return
  const models = { ...cached.models }
  const connected = new Set(cached.connected)
  let changed = false
  for (const fullModel of confirmed) {
    const slash = fullModel.indexOf("/")
    const provider = fullModel.slice(0, slash)
    const id = fullModel.slice(slash + 1)
    const entries = models[provider]
    if (
      !connected.has(provider) ||
      !entries ||
      entries.some((entry) => (typeof entry === "string" ? entry : entry.id) === id)
    )
      continue
    const strings = entries.filter((entry): entry is string => typeof entry === "string")
    models[provider] =
      strings.length === entries.length
        ? [...strings, id]
        : [...entries.map((entry) => (typeof entry === "string" ? { id: entry } : entry)), { id }]
    changed = true
  }
  if (changed) connectedProvidersCache.writeProviderModelsCache({ models, connected: cached.connected })
}

/**
 * A cached catalog can be partial: it was written before a model was registered. Before an explicitly requested
 * model on a provider the catalog already serves is treated as unreachable (and silently replaced by a
 * fallback), confirm it once against Core's live model list. A model the live list lacks stays missing.
 */
export async function confirmRequestedModels(
  client: OpencodeClient,
  available: Set<string>,
  requested: ReadonlyArray<string | undefined>,
): Promise<Set<string>> {
  const providers = new Set([...available].map((model) => model.split("/")[0]))
  const known = new Set([...available].map((model) => model.toLowerCase()))
  const requestedModels = requested.flatMap((model) => {
    const parsed = model ? parseModelString(model) : null
    return parsed ? [`${parsed.providerID}/${parsed.modelID}`] : []
  })
  const missing = requestedModels.filter((model) => {
    const provider = model.split("/")[0]
    return provider !== undefined && providers.has(provider) && !known.has(model.toLowerCase())
  })
  if (missing.length === 0 || !hasModelList(client)) return available
  try {
    const rows = extractModelRows(await client.model.list())
    const out = new Set(available)
    for (const row of rows) if (providers.has(row.provider)) out.add(`${row.provider}/${row.id}`)
    const live = new Map([...out].map((model) => [model.toLowerCase(), model]))
    const confirmed = missing
      .map((model) => live.get(model.toLowerCase()))
      .filter((model): model is string => model !== undefined)
    try {
      rememberConfirmedModels(confirmed)
    } catch (err) {
      // A cache I/O failure must not discard the model Core just confirmed live.
      log("[delegate-task] confirmed model cache refresh failed", {
        error: err instanceof Error ? err.message : String(err),
      })
    }
    log("[delegate-task] requested model missing from the cached catalog; checked the live catalog", {
      missing,
      confirmed,
    })
    return out
  } catch (err) {
    log("[delegate-task] live catalog check failed; keeping the cached catalog", {
      missing,
      error: err instanceof Error ? err.message : String(err),
    })
    return available
  }
}

export async function getAvailableModelsForDelegateTask(client: OpencodeClient): Promise<Set<string>> {
  const providerModelsCache = connectedProvidersCache.readProviderModelsCache()

  if (providerModelsCache?.models) {
    const connected = new Set(providerModelsCache.connected)

    const out = new Set<string>()
    for (const [providerID, models] of Object.entries(providerModelsCache.models)) {
      if (!connected.has(providerID)) continue
      addFromProviderModels(out, providerID, models as Array<string | { id?: string }> | undefined)
    }
    return out
  }

  const connectedProviders = connectedProvidersCache.readConnectedProvidersCache()

  if (!connectedProviders || connectedProviders.length === 0) {
    return new Set()
  }

  if (!hasModelList(client)) {
    return new Set()
  }

  try {
    const result = await client.model.list()
    const rows = extractModelRows(result)

    const connected = new Set(connectedProviders)
    const out = new Set<string>()
    for (const row of rows) {
      if (!connected.has(row.provider)) continue
      out.add(`${row.provider}/${row.id}`)
    }
    return out
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    log("[delegate-task] client.model.list failed", { error: errorMessage })
    return new Set()
  }
}
