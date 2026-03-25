import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getOpenCodeCacheDir } from "../../shared/data-path"

export type ProviderMap = Record<string, string[]>

export function getModelsByProvider(): ProviderMap {
  const cacheDir = getOpenCodeCacheDir()
  const modelsJsonPath = join(cacheDir, "models.json")
  const providerModelsJsonPath = join(cacheDir, "provider-models.json")
  
  const result: ProviderMap = Object.create(null)

  // Try provider-models.json first (preferred format)
  if (existsSync(providerModelsJsonPath)) {
    try {
      const content = readFileSync(providerModelsJsonPath, "utf-8")
      const data = JSON.parse(content)
      if (typeof data === "object" && data !== null && !Array.isArray(data)) {
        for (const [provider, models] of Object.entries(data)) {
          // Skip special keys and prototype pollution vectors
          if (provider === "connected" || provider === "updatedAt") continue
          if (provider === "__proto__" || provider === "constructor" || provider === "prototype") continue
          if (Array.isArray(models)) {
            result[provider] = models.filter((m): m is string => typeof m === "string").sort()
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Try models.json fallback (legacy format or API cache)
  if (existsSync(modelsJsonPath)) {
    try {
      const content = readFileSync(modelsJsonPath, "utf-8")
      const data = JSON.parse(content)

      if (typeof data === "object" && data !== null) {
        // Handle array format (legacy)
        if (Array.isArray(data)) {
           for (const item of data) {
             if (!item || typeof item !== "object") continue
             if (item.provider === "__proto__" || item.provider === "constructor" || item.provider === "prototype") continue
             if (item.provider && item.id) {
               if (!result[item.provider]) result[item.provider] = []
               if (!result[item.provider].includes(item.id)) {
                 result[item.provider].push(item.id)
               }
             }
           }
        } 
         // Handle provider map format
        else {
          for (const [providerId, providerData] of Object.entries(data)) {
            if (providerId === "__proto__" || providerId === "constructor" || providerId === "prototype") continue
            if (providerData && typeof providerData === 'object' && 'models' in providerData) {
              const modelsMap = (providerData as any).models
              if (modelsMap && typeof modelsMap === 'object') {
                if (!result[providerId]) result[providerId] = []
                const models = Object.keys(modelsMap)
                for (const m of models) {
                  if (!result[providerId].includes(m)) {
                    result[providerId].push(m)
                  }
                }
              }
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }
  
  // Sort all lists
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
