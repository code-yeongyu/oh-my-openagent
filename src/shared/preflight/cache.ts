import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getOpenCodeCacheDir } from "../data-path"
import type { ModelCache } from "./types"

function getCacheDir(): string {
  return getOpenCodeCacheDir()
}

function readModelsJson(): Record<string, unknown> | null {
  try {
    const dir = getCacheDir()
    const path = join(dir, "models.json")
    if (!existsSync(path)) return null
    const content = readFileSync(path, "utf-8")
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
}

function readProviderModelsJson(): Record<string, string[]> | null {
  try {
    const dir = getCacheDir()
    const path = join(dir, "provider-models.json")
    if (!existsSync(path)) return null
    const content = readFileSync(path, "utf-8")
    return JSON.parse(content) as Record<string, string[]>
  } catch {
    return null
  }
}

function normalizeModelId(provider: string, modelId: string): string {
  return `${provider}/${modelId}`
}

export function loadModelCache(): ModelCache {
  const models = new Set<string>()
  const providers = new Set<string>()

  // Try models.json first (complex format)
  const modelsJson = readModelsJson()
  if (modelsJson) {
    for (const [provider, data] of Object.entries(modelsJson)) {
      providers.add(provider)
      if (typeof data === "object" && data !== null && !Array.isArray(data)) {
        const providerData = data as Record<string, unknown>
        if (providerData.models && typeof providerData.models === "object") {
          const modelIds = Object.keys(providerData.models as Record<string, unknown>)
          for (const modelId of modelIds) {
            models.add(normalizeModelId(provider, modelId))
          }
        }
      }
    }
  }

  // Also try provider-models.json (simple format)
  const providerModelsJson = readProviderModelsJson()
  if (providerModelsJson) {
    for (const [provider, modelIds] of Object.entries(providerModelsJson)) {
      providers.add(provider)
      if (Array.isArray(modelIds)) {
        for (const modelId of modelIds) {
          if (typeof modelId === "string") {
            models.add(normalizeModelId(provider, modelId))
          }
        }
      }
    }
  }

  return { models, providers }
}
