import { LEGACY_PLUGIN_NAME, PLUGIN_NAME } from "./plugin-identity"

export function isLegacyEntry(entry: string): boolean {
  return entry === LEGACY_PLUGIN_NAME || entry.startsWith(`${LEGACY_PLUGIN_NAME}@`)
}

export function isCanonicalEntry(entry: string): boolean {
  return entry === PLUGIN_NAME || entry.startsWith(`${PLUGIN_NAME}@`)
}

export function toCanonicalEntry(entry: string): string {
  if (entry === LEGACY_PLUGIN_NAME) {
    return PLUGIN_NAME
  }

  if (entry.startsWith(`${LEGACY_PLUGIN_NAME}@`)) {
    return `${PLUGIN_NAME}${entry.slice(LEGACY_PLUGIN_NAME.length)}`
  }

  return entry
}
