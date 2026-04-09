import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseJsonc } from "../../../shared"
import type { AvailableModelsInfo } from "./model-resolution-types"

function getOpenCodeCacheDir(): string {
  const xdgCache = process.env.XDG_CACHE_HOME
  if (xdgCache) return join(xdgCache, "opencode")
  return join(homedir(), ".cache", "opencode")
}

function getOpenCodeConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME
  if (xdgConfig) return join(xdgConfig, "opencode")
  return join(homedir(), ".config", "opencode")
}

/**
 * Read custom provider names from opencode.json configs.
 * Custom providers defined in the user's opencode.json (under the "provider" key)
 * are valid at runtime but don't appear in the model cache (models.json), which
 * only contains built-in providers from models.dev. This causes false-positive
 * warnings in doctor.
 */
function loadCustomProviderNames(): string[] {
  const configDir = getOpenCodeConfigDir()
  const candidatePaths = [
    join(configDir, "opencode.json"),
    join(configDir, "opencode.jsonc"),
  ]

  for (const configPath of candidatePaths) {
    if (!existsSync(configPath)) continue
    try {
      const content = readFileSync(configPath, "utf-8")
      const data = parseJsonc<{ provider?: Record<string, unknown> }>(content)
      if (data?.provider && typeof data.provider === "object") {
        return Object.keys(data.provider)
      }
    } catch {
      // ignore parse errors
    }
  }

  return []
}

export function loadAvailableModelsFromCache(): AvailableModelsInfo {
  const cacheFile = join(getOpenCodeCacheDir(), "models.json")
  const customProviders = loadCustomProviderNames()

  if (!existsSync(cacheFile)) {
    // Even without the cache, custom providers are valid
    if (customProviders.length > 0) {
      return { providers: customProviders, modelCount: 0, cacheExists: true }
    }
    return { providers: [], modelCount: 0, cacheExists: false }
  }

  try {
    const content = readFileSync(cacheFile, "utf-8")
    const data = parseJsonc<Record<string, { models?: Record<string, unknown> }>>(content)

    const cacheProviders = Object.keys(data)
    let modelCount = 0
    for (const providerId of cacheProviders) {
      const models = data[providerId]?.models
      if (models && typeof models === "object") {
        modelCount += Object.keys(models).length
      }
    }

    // Merge cache providers with custom providers from opencode.json
    const allProviders = [...new Set([...cacheProviders, ...customProviders])]

    return { providers: allProviders, modelCount, cacheExists: true }
  } catch {
    return { providers: [], modelCount: 0, cacheExists: false }
  }
}
