import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getOpenCodeCacheDir } from "../data-path"

export type ProviderModels = Record<string, string[]>

/**
 * Load provider models from cache files.
 * Priority: provider-models.json > models.json
 */
export function loadProviderModelsFromCache(): ProviderModels {
  const dir = getOpenCodeCacheDir()
  const providerModelsPath = join(dir, "provider-models.json")
  const modelsJsonPath = join(dir, "models.json")

  // 1) Try provider-models.json (preferred, simple format)
  if (existsSync(providerModelsPath)) {
    try {
      const content = readFileSync(providerModelsPath, "utf-8")
      const data = JSON.parse(content)
      if (data && typeof data === "object" && !Array.isArray(data)) {
        // Validate it's Record<string, string[]>
        const result: ProviderModels = {}
        for (const [provider, models] of Object.entries(data)) {
          if (Array.isArray(models)) {
            result[provider] = models.filter((m): m is string => typeof m === "string")
          }
        }
        return result
      }
    } catch {
      // Fall through to models.json
    }
  }

  // 2) Fallback to models.json (complex nested format)
  if (existsSync(modelsJsonPath)) {
    try {
      const content = readFileSync(modelsJsonPath, "utf-8")
      const data = JSON.parse(content)
      const result: ProviderModels = {}

      if (data && typeof data === "object" && !Array.isArray(data)) {
        for (const [provider, providerData] of Object.entries(data)) {
          const pd = providerData as any
          if (pd?.models && typeof pd.models === "object") {
            result[provider] = Object.keys(pd.models)
          }
        }
      }
      return result
    } catch {
      // Return empty on error
    }
  }

  return {}
}

/**
 * Flatten provider models into "provider/model" format
 */
export function flattenProviderModels(models: ProviderModels): Set<string> {
  const set = new Set<string>()
  for (const [provider, modelIds] of Object.entries(models)) {
    for (const id of modelIds) {
      set.add(`${provider}/${id}`)
    }
  }
  return set
}

/**
 * Check if a specific model exists in cache
 */
export function isModelAvailable(model: string, available: Set<string>): boolean {
  return available.has(model)
}
