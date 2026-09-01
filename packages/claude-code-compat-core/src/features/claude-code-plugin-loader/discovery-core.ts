import { log } from "../../shared/logger"
import { shouldLoadPluginForCwd } from "./scope-filter"
import { getPluginsBaseDir } from "./discovery-paths"
import { extractPluginEntries, loadInstalledPlugins } from "./installed-plugin-database"
import { resolveActualInstallPath } from "./install-path-resolver"
import { createLoadedPlugin } from "./loaded-plugin"
import { loadPluginManifest } from "./plugin-manifest"
import { isPluginEnabled, loadClaudeSettings } from "./plugin-settings"
import type {
  LoadedPlugin,
  PluginLoadError,
  PluginLoaderOptions,
  PluginLoadResult,
} from "./types"

export function discoverInstalledPlugins(options?: PluginLoaderOptions): PluginLoadResult {
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

    const { installPath: configuredInstallPath } = installation
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
    const loadedPlugin = createLoadedPlugin(pluginKey, installation, installPath, manifest)

    plugins.push(loadedPlugin)
    log(`Discovered plugin: ${loadedPlugin.name}@${installation.version} (${installation.scope})`, {
      installPath,
      hasManifest: !!manifest,
    })
  }

  return { plugins, errors }
}
