import { checkForLegacyPluginEntry } from "./legacy-plugin-warning"
import { log } from "./logger"
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

  log("[OhMyOpenCodePlugin] Legacy plugin entry detected in OpenCode config", {
    legacyEntries: result.legacyEntries,
    suggestedEntries: result.legacyEntries.map(toCanonicalEntry),
    hasCanonicalEntry: result.hasCanonicalEntry,
  })
}
