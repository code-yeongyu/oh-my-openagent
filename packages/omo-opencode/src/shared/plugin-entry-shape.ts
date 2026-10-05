export type PluginEntryOptions = Record<string, unknown>
export type PluginTupleEntry = readonly [string, PluginEntryOptions]
export type PluginEntry = string | PluginTupleEntry

export function isPluginTupleEntry(entry: unknown): entry is PluginTupleEntry {
  return Array.isArray(entry) && typeof entry[0] === "string"
}

export function getPluginEntryName(entry: PluginEntry): string {
  return isPluginTupleEntry(entry) ? entry[0] : entry
}

export function withPluginEntryName(entry: PluginEntry, name: string): PluginEntry {
  return isPluginTupleEntry(entry) ? [name, entry[1]] : name
}
