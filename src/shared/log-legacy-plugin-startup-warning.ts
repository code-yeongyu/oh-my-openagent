import { checkForLegacyPluginEntry } from "./legacy-plugin-warning"
import { log } from "./logger"
import { migrateLegacyPluginEntry } from "./migrate-legacy-plugin-entry"
import { LEGACY_PLUGIN_NAME, PLUGIN_NAME } from "./plugin-identity"

function toCanonicalEntry(entry: string): string {
  if (entry === LEGACY_PLUGIN_NAME) {
    return PLUGIN_NAME
  }

  if (entry.startsWith(`${LEGACY_PLUGIN_NAME}@`)) {
    return `${PLUGIN_NAME}${entry.slice(LEGACY_PLUGIN_NAME.length)}`
  }

  return entry
}

export function logLegacyPluginStartupWarning(): void {
  const result = checkForLegacyPluginEntry()
  if (!result.hasLegacyEntry) {
    return
  }

  const suggestedEntries = result.legacyEntries.map(toCanonicalEntry)

  log("[OhMyOpenCodePlugin] Legacy plugin entry detected in OpenCode config", {
    legacyEntries: result.legacyEntries,
    suggestedEntries,
    hasCanonicalEntry: result.hasCanonicalEntry,
  })

  console.warn(
    `[oh-my-openagent] WARNING: Your opencode.json uses the legacy package name "${LEGACY_PLUGIN_NAME}".`
    + ` The package has been renamed to "${PLUGIN_NAME}".`
    + ` Attempting auto-migration...`,
  )

  const migrated = migrateLegacyPluginEntry(result.configPath!)
  if (migrated) {
    console.warn(`[oh-my-openagent] Auto-migrated opencode.json: ${result.legacyEntries.join(", ")} -> ${suggestedEntries.join(", ")}`)
  } else {
    console.warn(
      `[oh-my-openagent] Could not auto-migrate. Please manually update your opencode.json:`
      + ` ${result.legacyEntries.map((e, i) => `"${e}" -> "${suggestedEntries[i]}"`).join(", ")}`,
    )
  }
}
