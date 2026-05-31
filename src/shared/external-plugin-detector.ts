/**
 * Detects external plugins that may conflict with oh-my-opencode features.
 * Used to prevent crashes from concurrent notification plugins.
 */

import { loadOpencodePlugins } from "./load-opencode-plugins"
import { log } from "./logger"
import { CONFIG_BASENAME, PLUGIN_NAME } from "./plugin-identity"

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

const OMO_PACKAGE_PLUGINS = [
  "oh-my-opencode",
  "oh-my-openagent",
  "@code-yeongyu/oh-my-opencode",
  "@code-yeongyu/oh-my-openagent",
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

function isOmoFilePlugin(entry: string): boolean {
  const normalized = entry.toLowerCase().replaceAll("\\", "/")
  if (!normalized.startsWith("file://")) return false

  return /\/(omo(?:-[^/]*)?|oh-my-opencode|oh-my-openagent)\/(src|dist)\/index\.(ts|js)$/.test(normalized)
}

function matchesOmoPlugin(entry: string): string | null {
  const packageMatch = matchesKnownPlugin(entry, OMO_PACKAGE_PLUGINS)
  if (packageMatch) return packageMatch
  if (isOmoFilePlugin(entry)) return "oh-my-openagent"
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

export interface DuplicateOmoPluginResult {
  detected: boolean
  pluginName: string | null
  duplicatePlugins: string[]
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

export function detectDuplicateOmoPlugin(directory: string): DuplicateOmoPluginResult {
  const plugins = loadOpencodePlugins(directory)
  const duplicatePlugins = plugins.filter((plugin) => matchesOmoPlugin(plugin) !== null)

  if (duplicatePlugins.length > 1) {
    log("[oh-my-openagent] Duplicate OMO plugin entries detected", {
      duplicatePlugins,
      allPlugins: plugins,
    })
    return {
      detected: true,
      pluginName: "oh-my-openagent",
      duplicatePlugins,
      allPlugins: plugins,
    }
  }

  return {
    detected: false,
    pluginName: null,
    duplicatePlugins,
    allPlugins: plugins,
  }
}

/**
 * Generate a warning message for users with conflicting notification plugins.
 */
export function getNotificationConflictWarning(pluginName: string): string {
  return `[${PLUGIN_NAME}] External notification plugin detected: ${pluginName}

Both ${PLUGIN_NAME} and ${pluginName} listen to session.idle events.
   Running both simultaneously can cause crashes on Windows.

   ${PLUGIN_NAME}'s session-notification has been auto-disabled.

   To use ${PLUGIN_NAME}'s notifications instead, either:
   1. Remove ${pluginName} from your opencode.json plugins
   2. Or set "notification": { "force_enable": true } in ${CONFIG_BASENAME}.json`
}

/**
 * Generate a warning message for users with conflicting skill plugins.
 */
export function getSkillPluginConflictWarning(pluginName: string): string {
  return `[${PLUGIN_NAME}] External skill plugin detected: ${pluginName}

Both ${PLUGIN_NAME} and ${pluginName} scan ~/.config/opencode/skills/ and register tools independently.
   Running both simultaneously causes "Duplicate tool names detected" warnings and HTTP 400 errors.

   Consider either:
   1. Remove ${pluginName} from your opencode.json plugins to use ${PLUGIN_NAME}'s skill loading
   2. Or disable ${PLUGIN_NAME}'s skill loading by setting "claude_code.skills": false in ${CONFIG_BASENAME}.json
   3. Or uninstall ${PLUGIN_NAME} if you prefer ${pluginName}'s skill management`
}

export function getDuplicateOmoPluginWarning(duplicatePlugins: readonly string[]): string {
  const formattedPlugins = duplicatePlugins.map((plugin) => `   - ${plugin}`).join("\n")

  return `[${PLUGIN_NAME}] Duplicate OMO plugin entries detected:
${formattedPlugins}

Multiple ${PLUGIN_NAME} instances can inject internal prompts into the same live OpenCode session.
   That can create overlapping assistant turns and corrupt session state.

   ${PLUGIN_NAME} startup has been disabled for this plugin instance.

   Keep exactly one OMO plugin entry in your OpenCode config. Check both:
   1. ~/.config/opencode/opencode.json
   2. Any active OPENCODE_CONFIG_DIR profile, such as ~/.config/opencode/profiles/<name>/opencode.json`
}
