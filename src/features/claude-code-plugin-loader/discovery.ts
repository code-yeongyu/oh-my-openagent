import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { log } from "../../shared/logger"
import type {
  InstalledPluginsDatabase,
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

function getInstalledPluginsPath(): string {
  return join(getPluginsBaseDir(), "installed_plugins.json")
}

function loadInstalledPlugins(): InstalledPluginsDatabase | null {
  const dbPath = getInstalledPluginsPath()
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

function loadPluginManifest(installPath: string): PluginManifest | null {
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
  const atIndex = pluginKey.indexOf("@")
  return atIndex > 0 ? pluginKey.substring(0, atIndex) : pluginKey
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

function extractPluginEntries(
  db: InstalledPluginsDatabase,
): Array<[string, PluginInstallation | undefined]> {
  if (db.version === 1) {
    return Object.entries(db.plugins).map(([key, installation]) => [key, installation])
  }
  return Object.entries(db.plugins).map(([key, installations]) => [key, installations[0]])
}

export function discoverInstalledPlugins(options?: PluginLoaderOptions): PluginLoadResult {
  const db = loadInstalledPlugins()
  const settings = loadClaudeSettings()
  const plugins: LoadedPlugin[] = []
  const errors: PluginLoadError[] = []

  if (!db || !db.plugins) {
    return { plugins, errors }
  }

  const settingsEnabledPlugins = settings?.enabledPlugins
  const overrideEnabledPlugins = options?.enabledPluginsOverride

  for (const [pluginKey, installation] of extractPluginEntries(db)) {
    if (!installation) continue

    if (!isPluginEnabled(pluginKey, settingsEnabledPlugins, overrideEnabledPlugins)) {
      log(`Plugin disabled: ${pluginKey}`)
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

    const manifest = loadPluginManifest(installPath)
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
