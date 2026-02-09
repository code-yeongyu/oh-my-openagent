import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { AVAILABLE_MODELS } from "./types"

function getCacheDir(): string {
  // Try to use shared function if possible, otherwise simple fallback
  // ~/.cache/opencode on Linux/Mac
  return join(homedir(), ".cache", "opencode")
}

function loadModelsFromCache(): string[] {
  const cacheDir = getCacheDir()
  const modelsJsonPath = join(cacheDir, "models.json")
  const providerModelsJsonPath = join(cacheDir, "provider-models.json")

  let models: string[] = []

  // Try provider-models.json first (newer format)
  if (existsSync(providerModelsJsonPath)) {
    try {
      const content = readFileSync(providerModelsJsonPath, "utf-8")
      const data = JSON.parse(content)
      // Format: { "provider": ["model1", "model2"] }
      if (typeof data === "object" && data !== null) {
        for (const [provider, providerModels] of Object.entries(data)) {
          if (Array.isArray(providerModels)) {
            for (const model of providerModels) {
              models.push(`${provider}/${model}`)
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Try models.json fallback (legacy format or simple list)
  if (models.length === 0 && existsSync(modelsJsonPath)) {
    try {
      const content = readFileSync(modelsJsonPath, "utf-8")
      const data = JSON.parse(content)
      
      // If it's an array of model objects from API
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.provider && item.id) {
            models.push(`${item.provider}/${item.id}`)
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return models
}

export function getAvailableModels(): string[] {
  const cached = loadModelsFromCache()
  if (cached.length > 0) {
    // Merge with static known models to be safe, but unique
    return Array.from(new Set([...cached, ...AVAILABLE_MODELS])).sort()
  }
  
  return [...AVAILABLE_MODELS]
}
