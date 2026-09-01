import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { log } from "../../shared/logger"
import type { PluginManifest } from "./types"

export function findPluginManifestPath(installPath: string): string | null {
  const candidates = [
    join(installPath, ".claude-plugin", "plugin.json"),
    join(installPath, "plugin.json"),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

export function loadPluginManifest(installPath: string): PluginManifest | null {
  const manifestPath = findPluginManifestPath(installPath)
  if (!manifestPath) {
    return null
  }

  try {
    const content = readFileSync(manifestPath, "utf-8")
    return JSON.parse(content) as PluginManifest
  } catch (error) {
    if (error instanceof Error) {
      log(`Failed to load plugin manifest from ${manifestPath}`, error)
      return null
    }
    throw error
  }
}

export function readManifestFromPath(manifestPath: string): PluginManifest | null {
  try {
    const content = readFileSync(manifestPath, "utf-8")
    return JSON.parse(content) as PluginManifest
  } catch (error) {
    if (error instanceof Error) {
      return null
    }
    throw error
  }
}
