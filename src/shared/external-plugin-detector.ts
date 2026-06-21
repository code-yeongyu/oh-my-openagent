/**
 * Detects external plugins that may conflict with matrixx features.
 * Used to prevent crashes from concurrent notification plugins.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parseJsoncSafe } from "./jsonc-parser"
import { log } from "./logger"

interface OpencodeConfig {
  plugin?: string[]
}

/**
 * Known notification plugins that conflict with matrixx's session-notification.
 * Both plugins listen to session.idle and send notifications simultaneously,
 * which can cause crashes on Windows due to resource contention.
 */
const KNOWN_NOTIFICATION_PLUGINS = [
  "opencode-notifier",
  "@mohak34/opencode-notifier",
  "mohak34/opencode-notifier",
]

function getWindowsAppdataDir(): string | null {
  return process.env.APPDATA || null
}

function getConfigPaths(directory: string): string[] {
  const crossPlatformDir = path.join(os.homedir(), ".config")
  const paths = [
    path.join(directory, ".opencode", "opencode.json"),
    path.join(directory, ".opencode", "opencode.jsonc"),
    path.join(crossPlatformDir, "opencode", "opencode.json"),
    path.join(crossPlatformDir, "opencode", "opencode.jsonc"),
  ]

  if (process.platform === "win32") {
    const appdataDir = getWindowsAppdataDir()
    if (appdataDir) {
      paths.push(path.join(appdataDir, "opencode", "opencode.json"))
      paths.push(path.join(appdataDir, "opencode", "opencode.jsonc"))
    }
  }

  return paths
}

function loadOpencodePlugins(directory: string): string[] {
  for (const configPath of getConfigPaths(directory)) {
    try {
      if (!fs.existsSync(configPath)) continue
      const content = fs.readFileSync(configPath, "utf-8")
      const result = parseJsoncSafe<OpencodeConfig>(content)
      if (result.data) {
        return result.data.plugin ?? []
      }
    } catch {
    }
  }
  return []
}

/**
 * Check if a plugin entry matches a known notification plugin.
 * Handles various formats: "name", "name@version", "npm:name", "file://path/name"
 */
function matchesNotificationPlugin(entry: string): string | null {
  const normalized = entry.toLowerCase()
  for (const known of KNOWN_NOTIFICATION_PLUGINS) {
    // Exact match
    if (normalized === known) return known
    // Version suffix: "opencode-notifier@1.2.3"
    if (normalized.startsWith(`${known}@`)) return known
    // Scoped package: "@mohak34/opencode-notifier" or "@mohak34/opencode-notifier@1.2.3"
    if (normalized === `@mohak34/${known}` || normalized.startsWith(`@mohak34/${known}@`)) return known
    // npm: prefix
    if (normalized === `npm:${known}` || normalized.startsWith(`npm:${known}@`)) return known
    // file:// path ending exactly with package name
    if (normalized.startsWith("file://") && (
      normalized.endsWith(`/${known}`) || 
      normalized.endsWith(`\\${known}`)
    )) return known
  }
  return null
}

export interface ExternalNotifierResult {
  detected: boolean
  pluginName: string | null
  allPlugins: string[]
}

/**
 * Detect if any external notification plugin is configured.
 * Returns information about detected plugins for logging/warning.
 */
export function detectExternalNotificationPlugin(directory: string): ExternalNotifierResult {
  const plugins = loadOpencodePlugins(directory)
  
  for (const plugin of plugins) {
    const match = matchesNotificationPlugin(plugin)
    if (match) {
      log(`Detected external notification plugin: ${plugin}`)
      return {
        detected: true,
        pluginName: match,
        allPlugins: plugins,
      }
    }
  }

  return {
    detected: false,
    pluginName: null,
    allPlugins: plugins,
  }
}

/**
 * Generate a warning message for users with conflicting notification plugins.
 */
export function getNotificationConflictWarning(pluginName: string): string {
  return `[matrixx] External notification plugin detected: ${pluginName}

Both matrixx and ${pluginName} listen to session.idle events.
   Running both simultaneously can cause crashes on Windows.

   matrixx's session-notification has been auto-disabled.

   To use matrixx's notifications instead, either:
   1. Remove ${pluginName} from your opencode.json plugins
   2. Or set "notification": { "force_enable": true } in matrixx.json`
}
