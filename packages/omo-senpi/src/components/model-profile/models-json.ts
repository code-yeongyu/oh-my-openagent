import { statSync } from "node:fs"
import { join } from "node:path"

import { readJsoncFile } from "@oh-my-opencode/utils"

type CachedModelsJson = { readonly stamp: string; readonly parsed: unknown }

const cache = new Map<string, CachedModelsJson>()

function fileStamp(path: string): string | undefined {
  try {
    const stats = statSync(path)
    return `${stats.mtimeMs}:${stats.size}`
  } catch {
    return undefined
  }
}

// One parse of `<agentDir>/models.json` per process while the file is unchanged: session start
// resolves several profiles and retries after auth-probe exclusions, and each pass used to re-read
// and re-parse it. The stamp (mtime + size) keeps an edited file visible to the next session start.
export function readModelsJson(agentDir: string): unknown {
  const path = join(agentDir, "models.json")
  const stamp = fileStamp(path)
  if (stamp === undefined) {
    cache.delete(path)
    return null
  }
  const cached = cache.get(path)
  if (cached?.stamp === stamp) return cached.parsed
  const parsed = readJsoncFile<unknown>(path)
  cache.set(path, { stamp, parsed })
  return parsed
}
