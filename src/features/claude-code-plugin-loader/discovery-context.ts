import { getPluginsBaseDir } from "./discovery-paths"
import { loadInstalledPlugins } from "./installed-plugin-database"
import { loadPluginManifest } from "./plugin-manifest"
import { loadClaudeSettings } from "./plugin-settings"
import type {
  InstalledPluginsDatabase,
  PluginLoaderOptions,
  PluginManifest,
} from "./types"

export type PluginManifestLoader = (installPath: string) => PluginManifest | null

export interface PluginDiscoveryContext {
  readonly cwd: string
  readonly db: InstalledPluginsDatabase | null
  readonly manifestLoader: PluginManifestLoader
  readonly overrideEnabledPlugins: Record<string, boolean> | undefined
  readonly settingsEnabledPlugins: unknown
}

export function createPluginDiscoveryContext(
  options?: PluginLoaderOptions,
): PluginDiscoveryContext {
  const pluginsBaseDir = options?.pluginsHomeOverride ?? getPluginsBaseDir()
  const settings = loadClaudeSettings()
  return {
    cwd: process.cwd(),
    db: loadInstalledPlugins(pluginsBaseDir),
    manifestLoader: options?.loadPluginManifestOverride ?? loadPluginManifest,
    overrideEnabledPlugins: options?.enabledPluginsOverride,
    settingsEnabledPlugins: settings?.enabledPlugins,
  }
}
