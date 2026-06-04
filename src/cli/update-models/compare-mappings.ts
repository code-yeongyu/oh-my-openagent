import type { ModelMappingEntry } from "./types.js"

export function isDefaultEntry(
  currentEntry: ModelMappingEntry,
  generatedEntry: ModelMappingEntry
): boolean {
  if (currentEntry.model !== generatedEntry.model) {
    return false
  }

  if (currentEntry.variant !== generatedEntry.variant) {
    return false
  }

  const currentFallbacks = currentEntry.fallback_models ?? []
  const generatedFallbacks = generatedEntry.fallback_models ?? []

  if (currentFallbacks.length !== generatedFallbacks.length) {
    return false
  }

  for (let i = 0; i < currentFallbacks.length; i++) {
    if (currentFallbacks[i].model !== generatedFallbacks[i].model) {
      return false
    }
  }

  return true
}

export interface CompareMappingsResult {
  toUpdate: Record<string, ModelMappingEntry>
  toPreserve: string[]
  toAdd: Record<string, ModelMappingEntry>
}

export function compareMappings(
  current: Record<string, ModelMappingEntry>,
  generated: Record<string, ModelMappingEntry>
): CompareMappingsResult {
  const toUpdate: Record<string, ModelMappingEntry> = {}
  const toPreserve: string[] = []
  const toAdd: Record<string, ModelMappingEntry> = {}

  for (const [key, generatedEntry] of Object.entries(generated)) {
    const currentEntry = current[key]

    if (currentEntry === undefined) {
      toAdd[key] = generatedEntry
    } else if (isDefaultEntry(currentEntry, generatedEntry)) {
      toPreserve.push(key)
    } else {
      toUpdate[key] = generatedEntry
    }
  }

  return { toUpdate, toPreserve, toAdd }
}