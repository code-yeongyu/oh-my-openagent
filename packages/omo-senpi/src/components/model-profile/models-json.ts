import { statSync } from "node:fs"
import { join } from "node:path"

import { readJsoncFile } from "@oh-my-opencode/utils"

/** A parsed JSON value that is readonly at every depth, matching the frozen parse below. */
export type ModelsJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly ModelsJsonValue[]
  | { readonly [key: string]: ModelsJsonValue }

type CachedModelsJson = { readonly stamp: string; readonly parsed: ModelsJsonValue }

const cache = new Map<string, CachedModelsJson>()

function fileStamp(path: string): string | undefined {
  try {
    const stats = statSync(path)
    return `${stats.mtimeMs}:${stats.size}`
  } catch {
    return undefined
  }
}

/**
 * Freeze a fresh parse at every depth before it is shared. The parse is a JSON tree, so it
 * cannot contain a cycle, and the `Object.isFrozen` guard keeps a subtree shared inside the
 * same parse from being walked twice.
 */
function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return
  for (const child of Object.values(value)) deepFreeze(child)
  Object.freeze(value)
}

// One parse of `<agentDir>/models.json` per process while the file is unchanged: session start
// resolves several profiles and retries after auth-probe exclusions, and each pass used to re-read
// and re-parse it. The stamp (mtime + size) keeps an edited file visible to the next session start.
// The cached parse is deep-frozen and typed deeply readonly (#11034): every caller shares the one
// object, so a caller that narrowed it and wrote into it would otherwise change what every other
// reader in the process sees.
export function readModelsJson(agentDir: string): ModelsJsonValue {
  const path = join(agentDir, "models.json")
  const stamp = fileStamp(path)
  if (stamp === undefined) {
    cache.delete(path)
    return null
  }
  const cached = cache.get(path)
  if (cached?.stamp === stamp) return cached.parsed
  const parsed = readJsoncFile<ModelsJsonValue>(path) ?? null
  deepFreeze(parsed)
  cache.set(path, { stamp, parsed })
  return parsed
}
