import { join } from "node:path"

import { STALE_LOCK_JOURNAL } from "@oh-my-opencode/memory-core"
import { readFile } from "@oh-my-opencode/memory-core/fs"

/** #13808: how many stale index.lock files the writer removed, from the "removed" lines of its journal. */
export async function renderStaleLockRemovals(locksDir: string): Promise<string | undefined> {
  const text = await readFile(join(locksDir, STALE_LOCK_JOURNAL), "utf8").catch(() => null)
  if (text === null) return undefined
  const removals = text.split("\n").flatMap((line): { at: string; ageMs: number }[] => {
    if (line.trim().length === 0) return []
    try {
      const entry: unknown = JSON.parse(line)
      if (typeof entry !== "object" || entry === null) return []
      const { outcome, at, ageMs } = entry as { outcome?: unknown; at?: unknown; ageMs?: unknown }
      return outcome === "removed" && typeof at === "string" && typeof ageMs === "number" ? [{ at, ageMs }] : []
    } catch {
      return []
    }
  })
  const last = removals.at(-1)
  if (last === undefined) return undefined
  return `Stale index.lock removed: ${removals.length} (last ${last.at}, ${Math.round(last.ageMs / 60_000)} min old)`
}
