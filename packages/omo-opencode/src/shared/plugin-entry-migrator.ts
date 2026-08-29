import { getPluginEntryName, withPluginEntryName, type PluginEntry } from "./plugin-entry-shape"
import { LEGACY_PLUGIN_NAME, PLUGIN_NAME } from "./plugin-identity"

export function isLegacyEntry(entry: PluginEntry): boolean {
  const name = getPluginEntryName(entry)
  return name === LEGACY_PLUGIN_NAME || name.startsWith(`${LEGACY_PLUGIN_NAME}@`)
}

export function isCanonicalEntry(entry: PluginEntry): boolean {
  const name = getPluginEntryName(entry)
  return name === PLUGIN_NAME || name.startsWith(`${PLUGIN_NAME}@`)
}

export function toCanonicalEntry(entry: PluginEntry): PluginEntry {
  const name = getPluginEntryName(entry)

  if (name === LEGACY_PLUGIN_NAME) {
    return withPluginEntryName(entry, PLUGIN_NAME)
  }

  if (name.startsWith(`${LEGACY_PLUGIN_NAME}@`)) {
    return withPluginEntryName(entry, `${PLUGIN_NAME}${name.slice(LEGACY_PLUGIN_NAME.length)}`)
  }

  return entry
}
