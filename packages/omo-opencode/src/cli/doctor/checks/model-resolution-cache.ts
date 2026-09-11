import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  getOmoOpenCodeCacheDir,
  getOpenCodeCacheDir,
  parseJsonc,
  PROVIDER_MODELS_CACHE_FILE,
} from "../../../shared"
import type { AvailableModelsInfo } from "./model-resolution-types"

function getUserConfigDir(): string {
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
  const configDir = getUserConfigDir()
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
    } catch (error) {
      if (error instanceof Error) {
        continue
      }

      continue
    }
  }

  return []
}

interface ProviderModelsCacheFile {
  models?: Record<string, unknown>
}

function hasStringId(entry: object): boolean {
  return "id" in entry && typeof entry.id === "string"
}

function countProviderModelEntries(entries: unknown): number {
  if (!Array.isArray(entries)) return 0

  let count = 0
  for (const entry of entries) {
    if (typeof entry === "string") {
      count += 1
      continue
    }
    if (typeof entry === "object" && entry !== null && hasStringId(entry)) {
      count += 1
    }
  }
  return count
}

function readOmoProviderModelsCache(cacheFile: string): AvailableModelsInfo | null {
  if (!existsSync(cacheFile)) return null

  try {
    const content = readFileSync(cacheFile, "utf-8")
    const data = parseJsonc<ProviderModelsCacheFile>(content)
    const models = data?.models
    if (!models || typeof models !== "object" || Array.isArray(models)) return null

    const providers = Object.keys(models)
    let modelCount = 0
    for (const providerId of providers) {
      modelCount += countProviderModelEntries(models[providerId])
    }

    return { providers, modelCount, cacheExists: true, cachePath: cacheFile }
  } catch (error) {
    if (error instanceof Error) {
      return null
    }

    return null
  }
}

function readLegacyModelsCache(cacheFile: string):
  | { kind: "usable"; available: AvailableModelsInfo }
  | { kind: "missing" }
  | { kind: "malformed" } {
  if (!existsSync(cacheFile)) return { kind: "missing" }

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

    return {
      kind: "usable",
      available: { providers: cacheProviders, modelCount, cacheExists: true, cachePath: cacheFile },
    }
  } catch (error) {
    if (error instanceof Error) {
      return { kind: "malformed" }
    }

    return { kind: "malformed" }
  }
}

function mergeCustomProviders(available: AvailableModelsInfo, customProviders: string[]): AvailableModelsInfo {
  if (customProviders.length === 0) return available

  return {
    ...available,
    providers: [...new Set([...available.providers, ...customProviders])],
  }
}

export function loadAvailableModelsFromCache(): AvailableModelsInfo {
  const customProviders = loadCustomProviderNames()

  // Primary source: the cache `opencode models --refresh` and plugin startup actually write.
  const omoCacheFile = join(getOmoOpenCodeCacheDir(), PROVIDER_MODELS_CACHE_FILE)
  const omoAvailable = readOmoProviderModelsCache(omoCacheFile)
  if (omoAvailable) {
    return mergeCustomProviders(omoAvailable, customProviders)
  }

  // Fallback: legacy OpenCode-level cache maintained by opencode core.
  const legacyRead = readLegacyModelsCache(join(getOpenCodeCacheDir(), "models.json"))
  if (legacyRead.kind === "usable") {
    return mergeCustomProviders(legacyRead.available, customProviders)
  }
  if (legacyRead.kind === "malformed") {
    return { providers: [], modelCount: 0, cacheExists: false }
  }

  // Even without the cache, custom providers are valid
  if (customProviders.length > 0) {
    return { providers: customProviders, modelCount: 0, cacheExists: true }
  }
  return { providers: [], modelCount: 0, cacheExists: false }
}
