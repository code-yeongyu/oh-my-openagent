import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { basename, join } from "path"
import { fileURLToPath } from "url"
import { log } from "../../shared/logger"
import { shouldLoadPluginForCwd } from "./scope-filter"
import type {
  InstalledPluginsDatabase,
  InstalledPluginEntryV3,
  PluginInstallation,
  PluginManifest,
  LoadedPlugin,
  PluginLoadResult,
  PluginLoadError,
  PluginScope,
  ClaudeSettings,
  PluginLoaderOptions,
} from "./types"

function getPluginsBaseDir(): string {
  if (process.env.CLAUDE_PLUGINS_HOME) {
    return process.env.CLAUDE_PLUGINS_HOME
  }
  return join(homedir(), ".claude", "plugins")
}

function getInstalledPluginsPath(pluginsBaseDir?: string): string {
  return join(pluginsBaseDir ?? getPluginsBaseDir(), "installed_plugins.json")
}

function loadInstalledPlugins(pluginsBaseDir?: string): InstalledPluginsDatabase | null {
  const dbPath = getInstalledPluginsPath(pluginsBaseDir)
  if (!existsSync(dbPath)) {
    return null
  }

  try {
    const content = readFileSync(dbPath, "utf-8")
    return JSON.parse(content) as InstalledPluginsDatabase
  } catch (error) {
    log("Failed to load installed plugins database", error)
    return null
  }
}

function getClaudeSettingsPath(): string {
  if (process.env.CLAUDE_SETTINGS_PATH) {
    return process.env.CLAUDE_SETTINGS_PATH
  }
  return join(homedir(), ".claude", "settings.json")
}

function loadClaudeSettings(): ClaudeSettings | null {
  const settingsPath = getClaudeSettingsPath()
  if (!existsSync(settingsPath)) {
    return null
  }

  try {
    const content = readFileSync(settingsPath, "utf-8")
    return JSON.parse(content) as ClaudeSettings
  } catch (error) {
    log("Failed to load Claude settings", error)
    return null
  }
}

export function loadPluginManifest(installPath: string): PluginManifest | null {
  const manifestPath = join(installPath, ".claude-plugin", "plugin.json")
  if (!existsSync(manifestPath)) {
    return null
  }

  try {
    const content = readFileSync(manifestPath, "utf-8")
    return JSON.parse(content) as PluginManifest
  } catch (error) {
    log(`Failed to load plugin manifest from ${manifestPath}`, error)
    return null
  }
}

function derivePluginNameFromKey(pluginKey: string): string {
  const keyWithoutSource = pluginKey.startsWith("npm:") ? pluginKey.slice(4) : pluginKey

  let versionSeparator: number
  if (keyWithoutSource.startsWith("@")) {
    const scopeEnd = keyWithoutSource.indexOf("/")
    versionSeparator = scopeEnd > 0 ? keyWithoutSource.indexOf("@", scopeEnd) : -1
  } else {
    versionSeparator = keyWithoutSource.lastIndexOf("@")
  }
  const keyWithoutVersion = versionSeparator > 0 ? keyWithoutSource.slice(0, versionSeparator) : keyWithoutSource

  if (keyWithoutVersion.startsWith("file://")) {
    try {
      return basename(fileURLToPath(keyWithoutVersion))
    } catch {
      return basename(keyWithoutVersion)
    }
  }

  if (keyWithoutVersion.startsWith("@") && keyWithoutVersion.includes("/")) {
    return keyWithoutVersion
  }

  if (keyWithoutVersion.includes("/") || keyWithoutVersion.includes("\\")) {
    return basename(keyWithoutVersion)
  }

  return keyWithoutVersion
}

function isPluginEnabled(
  pluginKey: string,
  settingsEnabledPlugins: Record<string, boolean> | undefined,
  overrideEnabledPlugins: Record<string, boolean> | undefined,
): boolean {
  if (overrideEnabledPlugins && pluginKey in overrideEnabledPlugins) {
    return overrideEnabledPlugins[pluginKey]
  }
  if (settingsEnabledPlugins && pluginKey in settingsEnabledPlugins) {
    return settingsEnabledPlugins[pluginKey]
  }
  return true
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

function extractPluginEntries(
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

export function discoverInstalledPlugins(options?: PluginLoaderOptions): PluginLoadResult {
  // Allow overriding the plugins base directory for testing
  const pluginsBaseDir = options?.pluginsHomeOverride ?? getPluginsBaseDir()
  const db = loadInstalledPlugins(pluginsBaseDir)
  const settings = loadClaudeSettings()
  const plugins: LoadedPlugin[] = []
  const errors: PluginLoadError[] = []

  if (!db || (!Array.isArray(db) && !db.plugins)) {
    return { plugins, errors }
  }

  const settingsEnabledPlugins = settings?.enabledPlugins
  const overrideEnabledPlugins = options?.enabledPluginsOverride
  const pluginManifestLoader = options?.loadPluginManifestOverride ?? loadPluginManifest
  const cwd = process.cwd()

  for (const [pluginKey, installation] of extractPluginEntries(db)) {
    if (!installation) continue

    if (!isPluginEnabled(pluginKey, settingsEnabledPlugins, overrideEnabledPlugins)) {
      log(`Plugin disabled: ${pluginKey}`)
      continue
    }

    if (!shouldLoadPluginForCwd(installation, cwd)) {
      log(`Skipping ${installation.scope}-scoped plugin outside current cwd: ${pluginKey}`, {
        projectPath: installation.projectPath,
        cwd,
      })
      continue
    }

    const { installPath, scope, version } = installation

    if (!existsSync(installPath)) {
      errors.push({
        pluginKey,
        installPath,
        error: "Plugin installation path does not exist",
      })
      continue
    }

    const manifest = pluginManifestLoader(installPath)
    const pluginName = manifest?.name || derivePluginNameFromKey(pluginKey)

    const loadedPlugin: LoadedPlugin = {
      name: pluginName,
      version: version || manifest?.version || "unknown",
      scope: scope as PluginScope,
      installPath,
      pluginKey,
      manifest: manifest ?? undefined,
    }

    if (existsSync(join(installPath, "commands"))) {
      loadedPlugin.commandsDir = join(installPath, "commands")
    }
    if (existsSync(join(installPath, "agents"))) {
      loadedPlugin.agentsDir = join(installPath, "agents")
    }
    if (existsSync(join(installPath, "skills"))) {
      loadedPlugin.skillsDir = join(installPath, "skills")
    }

    const hooksPath = join(installPath, "hooks", "hooks.json")
    if (existsSync(hooksPath)) {
      loadedPlugin.hooksPath = hooksPath
    }

    const mcpPath = join(installPath, ".mcp.json")
    if (existsSync(mcpPath)) {
      loadedPlugin.mcpPath = mcpPath
    }

    plugins.push(loadedPlugin)
    log(`Discovered plugin: ${pluginName}@${version} (${scope})`, {
      installPath,
      hasManifest: !!manifest,
    })
  }

  return { plugins, errors }
}
