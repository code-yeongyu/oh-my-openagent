import type { DiscoveredLegacyConfigSource } from "./types"
import { isPlainRecord } from "./record-values"
import type { LoadedLegacyConfigSource } from "./transform-types"

function historyValues(value: unknown): readonly string[] {
  if (!isPlainRecord(value)) return []
  const values: string[] = []
  for (const key of ["_migrations", "appliedMigrations"]) {
    const candidate = value[key]
    if (!Array.isArray(candidate)) continue
    for (const item of candidate) {
      if (typeof item === "string" && !values.includes(item)) values.push(item)
    }
  }
  return values
}

export function legacyMigrationHistory(
  discovered: readonly DiscoveredLegacyConfigSource[],
  loaded: readonly LoadedLegacyConfigSource[],
): Record<string, readonly string[]> {
  const sourceByPath = new Map(discovered.map((source) => [source.path, source]))
  const history = new Map<string, string[]>()
  for (const source of loaded) {
    const metadata = sourceByPath.get(source.path)
    if (metadata === undefined) continue
    const values = historyValues(source.value)
    if (values.length === 0) continue
    const existing = history.get(metadata.configPath) ?? []
    for (const value of values) {
      if (!existing.includes(value)) existing.push(value)
    }
    history.set(metadata.configPath, existing)
  }
  return Object.fromEntries(history)
}
