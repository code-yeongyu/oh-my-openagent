import { log } from "../../shared/logger"
import { resolveActualInstallPath } from "./install-path-resolver"
import { createLoadedPlugin } from "./loaded-plugin"
import { isPluginEnabled } from "./plugin-settings"
import { shouldLoadPluginForCwd } from "./scope-filter"
import type { PluginDiscoveryContext } from "./discovery-context"
import type {
  LoadedPlugin,
  PluginInstallation,
  PluginLoadError,
} from "./types"

export type PluginEntryLoadResult =
  | { readonly kind: "loaded"; readonly plugin: LoadedPlugin }
  | { readonly kind: "error"; readonly error: PluginLoadError }
  | { readonly kind: "skipped" }

export function loadPluginEntry(
  pluginKey: string,
  installation: PluginInstallation,
  context: PluginDiscoveryContext,
): PluginEntryLoadResult {
  if (
    !isPluginEnabled(
      pluginKey,
      context.settingsEnabledPlugins,
      context.overrideEnabledPlugins,
    )
  ) {
    log(`Plugin disabled: ${pluginKey}`)
    return { kind: "skipped" }
  }

  if (!shouldLoadPluginForCwd(installation, context.cwd)) {
    log(`Skipping ${installation.scope}-scoped plugin outside current cwd: ${pluginKey}`, {
      projectPath: installation.projectPath,
      cwd: context.cwd,
    })
    return { kind: "skipped" }
  }

  const { installPath: configuredInstallPath } = installation
  const installPath = resolveActualInstallPath(configuredInstallPath, pluginKey)
  if (!installPath) {
    return {
      kind: "error",
      error: {
        pluginKey,
        installPath: configuredInstallPath,
        error: "Plugin installation path does not exist",
      },
    }
  }

  if (installPath !== configuredInstallPath) {
    log(`Recovered plugin install path for ${pluginKey}`, {
      configured: configuredInstallPath,
      resolved: installPath,
    })
  }

  const manifest = context.manifestLoader(installPath)
  const loadedPlugin = createLoadedPlugin(pluginKey, installation, installPath, manifest)

  log(`Discovered plugin: ${loadedPlugin.name}@${installation.version} (${installation.scope})`, {
    installPath,
    hasManifest: !!manifest,
  })

  return { kind: "loaded", plugin: loadedPlugin }
}
