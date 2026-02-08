import type { OpencodeClient } from "./types"
import { log } from "../../shared/logger"
import { readConnectedProvidersCache, readProviderModelsCache } from "../../shared/connected-providers-cache"

function addFromProviderModels(
  out: Set<string>,
  providerID: string,
  models: Array<string | { id?: string }> | undefined
): void {
  if (!models) return
  for (const item of models) {
    const modelID = typeof item === "string" ? item : item?.id
    if (!modelID) continue
    out.add(`${providerID}/${modelID}`)
  }
}

export async function getAvailableModelsForDelegateTask(client: OpencodeClient): Promise<Set<string>> {
  const providerModelsCache = readProviderModelsCache()

  if (providerModelsCache?.models) {
    const connected = new Set(providerModelsCache.connected)

    const out = new Set<string>()
    for (const [providerID, models] of Object.entries(providerModelsCache.models)) {
      if (!connected.has(providerID)) continue
      addFromProviderModels(out, providerID, models as Array<string | { id?: string }> | undefined)
    }
    return out
  }

  const connectedProviders = readConnectedProvidersCache()

  if (!connectedProviders || connectedProviders.length === 0) {
    return new Set()
  }

  const modelList = (client as unknown as { model?: { list?: () => Promise<unknown> } })
    ?.model
    ?.list

  if (!modelList) {
    return new Set()
  }

  try {
    const result = await modelList()
    const rows = Array.isArray(result)
      ? result
      : ((result as { data?: unknown }).data as Array<{ provider?: string; id?: string }> | undefined) ?? []

    const connected = new Set(connectedProviders)
    const out = new Set<string>()
    for (const row of rows) {
      if (!row?.provider || !row?.id) continue
      if (!connected.has(row.provider)) continue
      out.add(`${row.provider}/${row.id}`)
    }
    return out
  } catch (err) {
    log("[delegate-task] client.model.list failed", { error: String(err) })
    return new Set()
  }
}
