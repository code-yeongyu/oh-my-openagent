import { createPluginDiscoveryContext } from "./discovery-context"
import { loadPluginEntry } from "./discovery-entry-loader"
import { extractPluginEntries } from "./installed-plugin-database"
import type {
  LoadedPlugin,
  PluginLoadError,
  PluginLoaderOptions,
  PluginLoadResult,
} from "./types"

function unreachablePluginEntryResult(result: never): never {
  throw new TypeError(`Unexpected plugin entry result: ${JSON.stringify(result)}`)
}

export function discoverInstalledPlugins(options?: PluginLoaderOptions): PluginLoadResult {
  const context = createPluginDiscoveryContext(options)
  const plugins: LoadedPlugin[] = []
  const errors: PluginLoadError[] = []

  if (!context.db || (!Array.isArray(context.db) && !context.db.plugins)) {
    return { plugins, errors }
  }

  for (const [pluginKey, installation] of extractPluginEntries(context.db)) {
    if (!installation) continue

    const result = loadPluginEntry(pluginKey, installation, context)
    switch (result.kind) {
      case "loaded":
        plugins.push(result.plugin)
        break
      case "error":
        errors.push(result.error)
        break
      case "skipped":
        break
      default:
        unreachablePluginEntryResult(result)
    }
  }

  return { plugins, errors }
}
