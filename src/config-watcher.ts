import * as fs from "fs"
import * as path from "path"
import type { OhMyOpenCodeConfig } from "./config"
import { loadPluginConfig } from "./plugin-config"
import { getOpenCodeConfigDir, detectConfigFile, log } from "./shared"

const DEBOUNCE_MS = 300
const REATTACH_DELAY_MS = 100
const REATTACH_MAX_RETRIES = 5

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
 * Applies newConfig onto pluginConfig in-place, removing stale keys that
 * no longer exist in newConfig so deleted config sections don't linger.
 */
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
 * Creates a file watcher that hot-reloads plugin config when config files change.
 *
 * Watches user (~/.config/opencode/oh-my-opencode.json[c]) and project
 * (.opencode/oh-my-opencode.json[c]) config files. On change, reloads the full
 * merged config and applies it in-place so all existing references to
 * pluginConfig see the updated values.
 *
 * Handles atomic saves (write-tmp → rename) by reattaching the watcher
 * when a rename event is detected and the file reappears at the same path.
 *
 * Properties that won't hot-reload (by design):
 * - disabled_hooks (Set created once at startup)
 * - tmuxConfig (extracted once at startup)
 * - safe_hook_creation (boolean snapshotted at startup)
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

  /**
   * Attaches an fs.watch watcher for a config path. On rename events
   * (atomic save: write-tmp → rename over original), the old watcher's
   * inode is gone. We close it, wait for the file to reappear, and
   * reattach a fresh watcher.
   */
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

  /**
   * After an atomic-save rename, the file may not exist momentarily.
   * Retry up to REATTACH_MAX_RETRIES times with REATTACH_DELAY_MS between.
   */
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
        // Ignore close errors during dispose
      }
    }
    watchers.length = 0
    log("[config-watcher] Disposed — stopped watching config files")
  }
}
