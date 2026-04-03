/**
 * Detects external plugins that may conflict with oh-my-opencode features.
 * Used to prevent crashes from concurrent notification plugins.
 */

import { loadOpencodePlugins } from "./load-opencode-plugins"
import { log } from "./logger"

/**
 * Known notification plugins that conflict with oh-my-opencode's session-notification.
 * Both plugins listen to session.idle and send notifications simultaneously,
 * which can cause crashes on Windows due to resource contention.
 */
const KNOWN_NOTIFICATION_PLUGINS = [
  "opencode-notifier",
  "@mohak34/opencode-notifier",
  "mohak34/opencode-notifier",
]

/**
 * Known skill plugins that conflict with oh-my-opencode's skill loading.
 * Both plugins scan ~/.config/opencode/skills/ and register tools independently,
 * causing "Duplicate tool names detected" warnings and HTTP 400 errors.
 */
const KNOWN_SKILL_PLUGINS = [
  "opencode-skills",
  "@opencode/skills",
]

function matchesKnownPlugin(entry: string, knownPlugins: readonly string[]): string | null {
  const normalized = entry.toLowerCase()
  for (const known of knownPlugins) {
    if (normalized === known) return known
    if (normalized.startsWith(`${known}@`)) return known
    if (normalized === `npm:${known}` || normalized.startsWith(`npm:${known}@`)) return known
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

export interface ExternalSkillPluginResult {
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
    const match = matchesKnownPlugin(plugin, KNOWN_NOTIFICATION_PLUGINS)
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
 * Detect if any external skill plugin is configured.
 * Returns information about detected plugins for logging/warning.
 */
export function detectExternalSkillPlugin(directory: string): ExternalSkillPluginResult {
  const plugins = loadOpencodePlugins(directory)

  for (const plugin of plugins) {
    const match = matchesKnownPlugin(plugin, KNOWN_SKILL_PLUGINS)
    if (match) {
      log(`Detected external skill plugin: ${plugin}`)
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
  return `[oh-my-opencode] External notification plugin detected: ${pluginName}

Both oh-my-opencode and ${pluginName} listen to session.idle events.
   Running both simultaneously can cause crashes on Windows.

   oh-my-opencode's session-notification has been auto-disabled.

   To use oh-my-opencode's notifications instead, either:
   1. Remove ${pluginName} from your opencode.json plugins
   2. Or set "notification": { "force_enable": true } in oh-my-opencode.json`
}

/**
 * Generate a warning message for users with conflicting skill plugins.
 */
export function getSkillPluginConflictWarning(pluginName: string): string {
  return `[oh-my-opencode] External skill plugin detected: ${pluginName}

Both oh-my-opencode and ${pluginName} scan ~/.config/opencode/skills/ and register tools independently.
   Running both simultaneously causes "Duplicate tool names detected" warnings and HTTP 400 errors.

   Consider either:
   1. Remove ${pluginName} from your opencode.json plugins to use oh-my-opencode's skill loading
   2. Or disable oh-my-opencode's skill loading by setting "claude_code.skills": false in oh-my-opencode.json
   3. Or uninstall oh-my-opencode if you prefer ${pluginName}'s skill management`
}
