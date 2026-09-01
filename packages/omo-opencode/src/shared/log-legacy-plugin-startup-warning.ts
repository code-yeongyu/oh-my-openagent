import { checkForLegacyPluginEntry } from "./legacy-plugin-warning"
import { log } from "./logger"
import { migrateLegacyPluginEntry } from "./migrate-legacy-plugin-entry"
import { toCanonicalEntry } from "./plugin-entry-migrator"
import { getPluginEntryName, type PluginEntry } from "./plugin-entry-shape"
import { LEGACY_PLUGIN_NAME, PLUGIN_NAME } from "./plugin-identity"

function describeEntry(entry: PluginEntry): string {
  return getPluginEntryName(entry)
}

type LogLegacyPluginStartupWarningDeps = {
  checkForLegacyPluginEntry?: typeof checkForLegacyPluginEntry
  log?: typeof log
  migrateLegacyPluginEntry?: typeof migrateLegacyPluginEntry
}

export function logLegacyPluginStartupWarning(deps: LogLegacyPluginStartupWarningDeps = {}): void {
  const checkForLegacyPluginEntryFn = deps.checkForLegacyPluginEntry ?? checkForLegacyPluginEntry
  const logFn = deps.log ?? log
  const migrateLegacyPluginEntryFn = deps.migrateLegacyPluginEntry ?? migrateLegacyPluginEntry

  const result = checkForLegacyPluginEntryFn()
  if (!result.hasLegacyEntry || !result.configPath) {
    return
  }

  const suggestedEntries = result.legacyEntries.map(toCanonicalEntry)

  logFn("[legacy-migration] Legacy plugin entry detected in OpenCode config", {
    legacyEntries: result.legacyEntries,
    suggestedEntries,
    hasCanonicalEntry: result.hasCanonicalEntry,
  })

  console.warn(
    `[oh-my-openagent] WARNING: Your opencode.json uses the legacy package name "${LEGACY_PLUGIN_NAME}".`
    + ` The package has been renamed to "${PLUGIN_NAME}".`
    + ` Attempting auto-migration...`,
  )

  const migrated = migrateLegacyPluginEntryFn(result.configPath)
  if (migrated) {
    console.warn(`[oh-my-openagent] Auto-migrated opencode.json: ${result.legacyEntries.map(describeEntry).join(", ")} -> ${suggestedEntries.map(describeEntry).join(", ")}`)
  } else {
    console.warn(
      `[oh-my-openagent] Could not auto-migrate. Please manually update your opencode.json:`
      + ` ${result.legacyEntries.map((entry, index) => `"${describeEntry(entry)}" -> "${describeEntry(suggestedEntries[index] ?? entry)}"`).join(", ")}`,
    )
  }
}
