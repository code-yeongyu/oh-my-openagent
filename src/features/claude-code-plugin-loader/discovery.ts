import { existsSync, readdirSync, readFileSync } from "fs"
import { homedir } from "os"
import { basename, dirname, join } from "path"
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

function findPluginManifestPath(installPath: string): string | null {
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

function readManifestFromPath(manifestPath: string): PluginManifest | null {
  try {
    const content = readFileSync(manifestPath, "utf-8")
    return JSON.parse(content) as PluginManifest
  } catch {
    return null
  }
}

function parseSemverPrefix(name: string): [number, number, number] | null {
  const match = name.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)]
}

const SEMVER_SUFFIX_MARKER = /^\d+\.\d+\.\d+[-+]/

function compareCandidatePriority(
  a: { name: string },
  b: { name: string },
): number {
  const aIsUnknown = a.name === "unknown"
  const bIsUnknown = b.name === "unknown"
  if (aIsUnknown && !bIsUnknown) return 1
  if (!aIsUnknown && bIsUnknown) return -1

  const aVer = parseSemverPrefix(a.name)
  const bVer = parseSemverPrefix(b.name)
  if (aVer && bVer) {
    if (aVer[0] !== bVer[0]) return bVer[0] - aVer[0]
    if (aVer[1] !== bVer[1]) return bVer[1] - aVer[1]
    if (aVer[2] !== bVer[2]) return bVer[2] - aVer[2]
    const aHasSuffix = SEMVER_SUFFIX_MARKER.test(a.name)
    const bHasSuffix = SEMVER_SUFFIX_MARKER.test(b.name)
    if (!aHasSuffix && bHasSuffix) return -1
    if (aHasSuffix && !bHasSuffix) return 1
    return a.name.localeCompare(b.name)
  }
  if (aVer && !bVer) return -1
  if (!aVer && bVer) return 1
  return a.name.localeCompare(b.name)
}

export function resolveActualInstallPath(
  configuredInstallPath: string,
  pluginKey?: string,
): string | null {
  if (existsSync(configuredInstallPath)) {
    return configuredInstallPath
  }
  const parentDir = dirname(configuredInstallPath)
  if (!existsSync(parentDir)) {
    return null
  }
  let entries: string[]
  try {
    entries = readdirSync(parentDir)
  } catch (error) {
    log("Failed to scan plugin parent directory for fallback version", {
      parentDir,
      error,
    })
    return null
  }

  const expectedName = pluginKey ? derivePluginNameFromKey(pluginKey) : null

  const candidates = entries
    .map((name) => ({ name, path: join(parentDir, name) }))
    .filter(({ path }) => {
      const manifestPath = findPluginManifestPath(path)
      if (!manifestPath) return false
      if (expectedName === null) return true
      const manifest = readManifestFromPath(manifestPath)
      if (!manifest?.name) return false
      return manifest.name === expectedName
    })
    .sort(compareCandidatePriority)
  return candidates[0]?.path ?? null
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

    const { installPath: configuredInstallPath, scope, version } = installation

    const installPath = resolveActualInstallPath(configuredInstallPath, pluginKey)
    if (!installPath) {
      errors.push({
        pluginKey,
        installPath: configuredInstallPath,
        error: "Plugin installation path does not exist",
      })
      continue
    }

    if (installPath !== configuredInstallPath) {
      log(`Recovered plugin install path for ${pluginKey}`, {
        configured: configuredInstallPath,
        resolved: installPath,
      })
    }

    const manifest = pluginManifestLoader(installPath)
    const pluginName = manifest?.name || derivePluginNameFromKey(pluginKey)

    const installationVersionTrim = typeof version === "string" ? version.trim() : ""
    const installationVersion =
      installationVersionTrim !== "" && installationVersionTrim !== "unknown"
        ? version
        : null
    const manifestVersionTrim =
      typeof manifest?.version === "string" ? manifest.version.trim() : ""
    const manifestVersion = manifestVersionTrim !== "" ? manifest?.version : null
    const rawVersion = installationVersionTrim !== "" ? version : null
    const resolvedVersion = installationVersion ?? manifestVersion ?? rawVersion ?? "unknown"

    const loadedPlugin: LoadedPlugin = {
      name: pluginName,
      version: resolvedVersion,
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
