import { readFileSync } from "node:fs"
import { join } from "node:path"

import { createConnectedProvidersCacheStore } from "../../shared/connected-providers-cache"
import { getOmoOpenCodeCacheDir, getOpenCodeCacheDir } from "../../shared/data-path"

export type EditorModels = ReadonlyMap<string, readonly string[]>

type ReadEditorModelsOptions = {
  readonly providerCacheDirectory?: string
  readonly modelsPath?: string
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function safeProvider(value: unknown): value is string {
  return typeof value === "string"
    && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
    && !["__proto__", "constructor", "prototype"].includes(value)
}

function safeModel(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !/[\s\x00-\x1f\x7f-\x9f]/.test(value)
}

export function validateEditorModel(value: unknown): string | undefined {
  if (typeof value !== "string") return "Enter a model as provider/model."
  const model = value.trim()
  const slash = model.indexOf("/")
  if (slash < 1 || !safeProvider(model.slice(0, slash)) || !safeModel(model.slice(slash + 1))) {
    return "Enter a model as provider/model, without spaces."
  }
  return undefined
}

/** Catalog entries are suggestions only; a cached model does not prove provider availability. */
export function collectEditorModels(providerCache: unknown, legacyCache: unknown): EditorModels {
  const result = new Map<string, Set<string>>()
  function add(provider: unknown, value: unknown): void {
    if (!safeProvider(provider)) return
    const model = typeof value === "string" ? value : record(value) ? value["id"] : undefined
    if (!safeModel(model)) return
    const models = result.get(provider) ?? new Set<string>()
    models.add(model)
    result.set(provider, models)
  }

  // The plugin cache wraps both string ids and metadata entries in `models`.
  if (record(providerCache) && record(providerCache["models"])) {
    for (const [provider, entries] of Object.entries(providerCache["models"])) {
      if (Array.isArray(entries)) for (const entry of entries) add(provider, entry)
    }
  }

  // OpenCode has shipped both a legacy list and the models.dev provider map.
  if (Array.isArray(legacyCache)) {
    for (const entry of legacyCache) {
      if (record(entry)) add(entry["provider"], entry["id"])
    }
  } else if (record(legacyCache)) {
    for (const [provider, data] of Object.entries(legacyCache)) {
      if (!record(data) || !record(data["models"])) continue
      for (const [id, metadata] of Object.entries(data["models"])) {
        add(provider, record(metadata) && typeof metadata["id"] === "string" ? metadata["id"] : id)
      }
    }
  }

  return new Map([...result.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, models]) => [provider, [...models].sort()]))
}

export function readEditorModels(options: ReadEditorModelsOptions = {}): EditorModels {
  const store = createConnectedProvidersCacheStore(
    () => options.providerCacheDirectory ?? getOmoOpenCodeCacheDir(),
  )
  let legacy: unknown
  try {
    legacy = JSON.parse(readFileSync(options.modelsPath ?? join(getOpenCodeCacheDir(), "models.json"), "utf-8"))
  } catch {
    // Missing or stale caches must never prevent custom model entry.
  }
  return collectEditorModels(store.readProviderModelsCache(), legacy)
}
