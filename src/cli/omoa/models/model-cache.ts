import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getOpenCodeCacheDir } from "../../../shared/data-path"

export type ProviderMap = Record<string, string[]>

const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype", "connected", "updatedAt"])

export function getModelsByProvider(): ProviderMap {
  const cacheDir = getOpenCodeCacheDir()
  const providerModelsPath = join(cacheDir, "provider-models.json")
  const modelsPath = join(cacheDir, "models.json")

  const result: ProviderMap = Object.create(null)

  if (existsSync(providerModelsPath)) {
    try {
      const content = readFileSync(providerModelsPath, "utf-8")
      const data = JSON.parse(content)
      if (typeof data === "object" && data !== null && !Array.isArray(data)) {
        for (const [provider, models] of Object.entries(data)) {
          if (RESERVED_KEYS.has(provider)) continue
          if (Array.isArray(models)) {
            result[provider] = models.filter((m): m is string => typeof m === "string").sort()
          }
        }
      }
    } catch { /* ignore */ }
  }

  if (existsSync(modelsPath)) {
    try {
      const content = readFileSync(modelsPath, "utf-8")
      const data = JSON.parse(content)
      if (typeof data === "object" && data !== null) {
        if (Array.isArray(data)) {
          for (const item of data) {
            if (!item || typeof item !== "object") continue
            const entry = item as { provider?: string; id?: string }
            if (!entry.provider || RESERVED_KEYS.has(entry.provider)) continue
            if (!entry.id) continue
            if (!result[entry.provider]) result[entry.provider] = []
            if (!result[entry.provider].includes(entry.id)) {
              result[entry.provider].push(entry.id)
            }
          }
        } else {
          for (const [providerId, providerData] of Object.entries(data)) {
            if (RESERVED_KEYS.has(providerId)) continue
            if (providerData && typeof providerData === "object" && "models" in providerData) {
              const modelsMap = (providerData as { models?: unknown }).models
              if (modelsMap && typeof modelsMap === "object") {
                if (!result[providerId]) result[providerId] = []
                for (const m of Object.keys(modelsMap as object)) {
                  if (!result[providerId].includes(m)) {
                    result[providerId].push(m)
                  }
                }
              }
            }
          }
        }
      }
    } catch { /* ignore */ }
  }

  for (const provider in result) {
    result[provider].sort()
  }

  return result
}

export function getAllCachedModels(): string[] {
  const map = getModelsByProvider()
  const list: string[] = []
  for (const [provider, models] of Object.entries(map)) {
    for (const model of models) {
      list.push(`${provider}/${model}`)
    }
  }
  return list.sort()
}

export function getAllProviders(): string[] {
  return Object.keys(getModelsByProvider()).sort()
}
