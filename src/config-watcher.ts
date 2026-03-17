import * as fs from "fs"
import * as path from "path"
import type { OhMyOpenCodeConfig } from "./config"
import { loadPluginConfig } from "./plugin-config"
import { getOpenCodeConfigDir, detectConfigFile, log } from "./shared"

const DEBOUNCE_MS = 300

export interface ConfigWatcherDispose {
  (): void
}

/**
 * Resolves the actual config file paths for user-level and project-level configs.
 * Returns only paths that exist on disk.
 */
function resolveConfigPaths(directory: string): string[] {
  const paths: string[] = []

  const configDir = getOpenCodeConfigDir({ binary: "opencode" })
  const userBasePath = path.join(configDir, "oh-my-opencode")
  const userDetected = detectConfigFile(userBasePath)
  if (userDetected.format !== "none") {
    paths.push(userDetected.path)
  }

  const projectBasePath = path.join(directory, ".opencode", "oh-my-opencode")
  const projectDetected = detectConfigFile(projectBasePath)
  if (projectDetected.format !== "none") {
    paths.push(projectDetected.path)
  }

  return paths
}

/**
 * Creates a file watcher that hot-reloads plugin config when config files change.
 *
 * Watches user (~/.config/opencode/oh-my-opencode.json[c]) and project
 * (.opencode/oh-my-opencode.json[c]) config files. On change, reloads the full
 * merged config and applies it in-place via Object.assign so all existing
 * references to pluginConfig see the updated values.
 *
 * Properties that won't hot-reload (by design):
 * - disabled_hooks (Set created once at startup)
 * - tmuxConfig (extracted once at startup)
 */
export function createConfigWatcher(
  directory: string,
  ctx: unknown,
  pluginConfig: OhMyOpenCodeConfig,
): ConfigWatcherDispose {
  const watchers: fs.FSWatcher[] = []
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const configPaths = resolveConfigPaths(directory)

  if (configPaths.length === 0) {
    log("[config-watcher] No config files found to watch")
    return () => {}
  }

  const reloadConfig = (): void => {
    try {
      const newConfig = loadPluginConfig(directory, ctx)
      Object.assign(pluginConfig, newConfig)
      log("[config-watcher] Config hot-reloaded successfully", {
        agents: newConfig.agents,
        categories: newConfig.categories,
      })
    } catch (error) {
      // On any error, keep the old config intact
      log("[config-watcher] Config reload failed, keeping previous config", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const debouncedReload = (): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(reloadConfig, DEBOUNCE_MS)
  }

  for (const configPath of configPaths) {
    try {
      const watcher = fs.watch(configPath, (eventType) => {
        if (eventType === "change" || eventType === "rename") {
          log("[config-watcher] Config file changed", { path: configPath, eventType })
          debouncedReload()
        }
      })

      watcher.on("error", (error) => {
        log("[config-watcher] Watcher error", {
          path: configPath,
          error: error instanceof Error ? error.message : String(error),
        })
      })

      watchers.push(watcher)
      log("[config-watcher] Watching config file", { path: configPath })
    } catch (error) {
      log("[config-watcher] Failed to watch config file", {
        path: configPath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    for (const watcher of watchers) {
      try {
        watcher.close()
      } catch {
        // Ignore close errors during dispose
      }
    }
    watchers.length = 0
    log("[config-watcher] Disposed — stopped watching config files")
  }
}
