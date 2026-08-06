import { existsSync, readFileSync } from "fs"
import { log } from "../../shared/logger"
import { getInstalledPluginsPath } from "./discovery-paths"
import type {
  InstalledPluginEntryV3,
  InstalledPluginsDatabase,
  PluginInstallation,
} from "./types"

export function loadInstalledPlugins(pluginsBaseDir?: string): InstalledPluginsDatabase | null {
  const dbPath = getInstalledPluginsPath(pluginsBaseDir)
  if (!existsSync(dbPath)) {
    return null
  }

  try {
    const content = readFileSync(dbPath, "utf-8")
    return JSON.parse(content) as InstalledPluginsDatabase
  } catch (error) {
    if (error instanceof Error) {
      log("Failed to load installed plugins database", error)
      return null
    }
    throw error
  }
}

function v3EntryToInstallation(entry: InstalledPluginEntryV3): PluginInstallation {
  return {
    scope: entry.scope,
    installPath: entry.installPath,
    version: entry.version,
    installedAt: entry.lastUpdated,
    lastUpdated: entry.lastUpdated,
    gitCommitSha: entry.gitCommitSha,
    projectPath: entry.projectPath,
  }
}

function isValidV3Entry(entry: unknown): entry is InstalledPluginEntryV3 {
  return (
    entry != null &&
    typeof entry === "object" &&
    typeof (entry as Record<string, unknown>).name === "string" &&
    typeof (entry as Record<string, unknown>).marketplace === "string" &&
    typeof (entry as Record<string, unknown>).installPath === "string"
  )
}

export function extractPluginEntries(
  db: InstalledPluginsDatabase,
): Array<[string, PluginInstallation | undefined]> {
  if (Array.isArray(db)) {
    return db
      .filter(isValidV3Entry)
      .map((entry) => [
        `${entry.name}@${entry.marketplace}`,
        v3EntryToInstallation(entry),
      ])
  }
  if (db.version === 1) {
    return Object.entries(db.plugins).map(([key, installation]) => [key, installation])
  }
  return Object.entries(db.plugins).map(([key, installations]) => [key, installations[0]])
}
