import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getOpenCodeCacheDir } from "../../shared/data-path"

export type ProviderMap = Record<string, string[]>

export function getModelsByProvider(): ProviderMap {
  const cacheDir = getOpenCodeCacheDir()
  const modelsJsonPath = join(cacheDir, "models.json")
  
  const result: ProviderMap = {}

  if (existsSync(modelsJsonPath)) {
    try {
      const content = readFileSync(modelsJsonPath, "utf-8")
      const data = JSON.parse(content)

      if (typeof data === "object" && data !== null) {
        // Handle array format (legacy)
        if (Array.isArray(data)) {
           for (const item of data) {
             if (item.provider && item.id) {
               if (!result[item.provider]) result[item.provider] = []
               result[item.provider].push(item.id)
             }
           }
        } 
        // Handle provider map format
        else {
          for (const [providerId, providerData] of Object.entries(data)) {
            if (providerData && typeof providerData === 'object' && 'models' in providerData) {
              const modelsMap = (providerData as any).models
              if (modelsMap && typeof modelsMap === 'object') {
                result[providerId] = Object.keys(modelsMap).sort()
              }
            }
          }
        }
      }
    } catch {
      // ignore
    }
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
