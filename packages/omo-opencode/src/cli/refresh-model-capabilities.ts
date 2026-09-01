import { loadPluginConfig } from "../plugin-config"
import { refreshModelCapabilitiesCache } from "../shared/model-capabilities-cache"

export type RefreshModelCapabilitiesOptions = {
  directory?: string
  json?: boolean
  sourceUrl?: string
}

type RefreshModelCapabilitiesDeps = {
  loadConfig?: typeof loadPluginConfig
  refreshCache?: typeof refreshModelCapabilitiesCache
  stdout?: Pick<typeof process.stdout, "write">
  stderr?: Pick<typeof process.stderr, "write">
}

export async function refreshModelCapabilities(
  options: RefreshModelCapabilitiesOptions,
  deps: RefreshModelCapabilitiesDeps = {},
): Promise<number> {
  const directory = options.directory ?? process.cwd()
  const loadConfig = deps.loadConfig ?? loadPluginConfig
  const refreshCache = deps.refreshCache ?? refreshModelCapabilitiesCache
  const stdout = deps.stdout ?? process.stdout
  const stderr = deps.stderr ?? process.stderr

  try {
    const config = loadConfig(directory, null)
    const sourceUrl = options.sourceUrl ?? config.model_capabilities?.source_url
    const snapshot = await refreshCache({ sourceUrl })

    const summary = {
      sourceUrl: snapshot.sourceUrl,
      generatedAt: snapshot.generatedAt,
      modelCount: Object.keys(snapshot.models).length,
    }

    if (options.json) {
      stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    } else {
      stdout.write(
        `Refreshed model capabilities cache (${summary.modelCount} models) from ${summary.sourceUrl}\n`,
      )
    }

    return 0
  } catch (error) {
    stderr.write(`Failed to refresh model capabilities cache: ${String(error)}\n`)
    return 1
  }
}
