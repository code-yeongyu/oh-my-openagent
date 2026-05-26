import * as fs from "fs"
import * as path from "path"
import type { OhMyOpenCodeConfig } from "./config"
import { loadPluginConfig } from "./plugin-config"
import { getOpenCodeConfigDir, detectConfigFile, log } from "./shared"
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "./shared/plugin-identity"

const DEBOUNCE_MS = 300
const REATTACH_DELAY_MS = 100
const REATTACH_MAX_RETRIES = 5

export interface ConfigWatcherDispose {
  (): void
}

function resolveConfigPaths(directory: string): string[] {
  const paths: string[] = []

  const configDir = getOpenCodeConfigDir({ binary: "opencode" })

  const canonicalUserPath = path.join(configDir, CONFIG_BASENAME)
  const canonicalDetected = detectConfigFile(canonicalUserPath)
  if (canonicalDetected.format !== "none") {
    paths.push(canonicalDetected.path)
  } else {
    const legacyUserPath = path.join(configDir, LEGACY_CONFIG_BASENAME)
    const legacyDetected = detectConfigFile(legacyUserPath)
    if (legacyDetected.format !== "none") {
      paths.push(legacyDetected.path)
    }
  }

  const canonicalProjectPath = path.join(directory, ".opencode", CONFIG_BASENAME)
  const canonicalProjectDetected = detectConfigFile(canonicalProjectPath)
  if (canonicalProjectDetected.format !== "none") {
    paths.push(canonicalProjectDetected.path)
  } else {
    const legacyProjectPath = path.join(directory, ".opencode", LEGACY_CONFIG_BASENAME)
    const legacyProjectDetected = detectConfigFile(legacyProjectPath)
    if (legacyProjectDetected.format !== "none") {
      paths.push(legacyProjectDetected.path)
    }
  }

  return paths
}

function applyConfigInPlace(
  pluginConfig: OhMyOpenCodeConfig,
  newConfig: OhMyOpenCodeConfig,
): void {
  for (const key of Object.keys(pluginConfig)) {
    if (!(key in newConfig)) {
      delete (pluginConfig as Record<string, unknown>)[key]
    }
  }
  Object.assign(pluginConfig, newConfig)
}

/**
 * Watches user and project config files, hot-reloading plugin config on change.
 *
 * Handles atomic saves (write-tmp → rename) by reattaching the watcher
 * when a rename event is detected and the file reappears.
 *
 * Properties that won't hot-reload (startup-snapshotted by design):
 * - disabled_hooks, tmuxConfig, safe_hook_creation
 */
export function createConfigWatcher(
  directory: string,
  ctx: unknown,
  pluginConfig: OhMyOpenCodeConfig,
): ConfigWatcherDispose {
  const watchers: fs.FSWatcher[] = []
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const configPaths = resolveConfigPaths(directory)

  if (configPaths.length === 0) {
    log("[config-watcher] No config files found to watch")
    return () => {}
  }

  const reloadConfig = (): void => {
    try {
      const newConfig = loadPluginConfig(directory, ctx)
      applyConfigInPlace(pluginConfig, newConfig)
      log("[config-watcher] Config hot-reloaded successfully", {
        agents: newConfig.agents,
        categories: newConfig.categories,
      })
    } catch (error) {
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

  const attachWatcher = (configPath: string): void => {
    if (disposed) return

    try {
      const watcher = fs.watch(configPath, (eventType) => {
        if (disposed) return

        if (eventType === "change") {
          log("[config-watcher] Config file changed", { path: configPath, eventType })
          debouncedReload()
        } else if (eventType === "rename") {
          log("[config-watcher] Config file renamed (atomic save detected)", { path: configPath })
          watcher.close()
          const idx = watchers.indexOf(watcher)
          if (idx !== -1) watchers.splice(idx, 1)
          reattachAfterRename(configPath, 0)
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

  const reattachAfterRename = (configPath: string, attempt: number): void => {
    if (disposed) return
    if (attempt >= REATTACH_MAX_RETRIES) {
      log("[config-watcher] File did not reappear after rename, giving up", { path: configPath })
      return
    }

    setTimeout(() => {
      if (disposed) return
      if (fs.existsSync(configPath)) {
        debouncedReload()
        attachWatcher(configPath)
      } else {
        reattachAfterRename(configPath, attempt + 1)
      }
    }, REATTACH_DELAY_MS)
  }

  for (const configPath of configPaths) {
    attachWatcher(configPath)
  }

  return (): void => {
    disposed = true
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    for (const watcher of watchers) {
      try {
        watcher.close()
      } catch {
        // ignore close errors during dispose
      }
    }
    watchers.length = 0
    log("[config-watcher] Disposed — stopped watching config files")
  }
}
