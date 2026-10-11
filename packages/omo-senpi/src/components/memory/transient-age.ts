// Bounded activity probe for the transient sweep (issue #7765).
//
// A directory's own mtime only tracks its direct entries, so a run whose transcript grows in a
// leaf would otherwise look untouched since it started. The probe therefore walks the tree, and
// the walk is bounded in both depth and entries because a sweep must never walk real memory.
//
// The verdict only needs ONE mtime newer than the cutoff, never the newest one, so the walk stops
// at the first entry that proves the tree active - starting with the root's own mtime. On a real
// agents root almost every surviving identity was touched recently, so that single stat replaces
// the whole listing (issue #8412: 2213 stat + 1052 readdir per startup before this).
//
// The filesystem is a parameter so the walk's cost - not only its verdict - is testable:
// `nodeAgeProbeFs` is the only production implementation.

import { readdir, stat } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

/** Six levels reach a run root's transcript leaves (`agents/<id>/runtime/transcripts/<session>/*`). */
export const MAX_AGE_DEPTH = 6
export const MAX_AGE_ENTRIES = 512

export interface AgeProbeEntry {
  readonly name: string
  readonly directory: boolean
}

export interface AgeProbeFs {
  list(path: string): Promise<readonly AgeProbeEntry[]>
  mtimeMs(path: string): Promise<number | undefined>
}

/**
 * - active: the tree holds an mtime strictly newer than the cutoff.
 * - idle: every readable mtime is at or before the cutoff.
 * - unknown: nothing in the bounded walk had a readable mtime; a missing root reports this.
 */
export type TreeActivity = "active" | "idle" | "unknown"

export const nodeAgeProbeFs: AgeProbeFs = {
  async list(path: string): Promise<readonly AgeProbeEntry[]> {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.map((entry) => ({ name: entry.name, directory: entry.isDirectory() }))
  },
  async mtimeMs(path: string): Promise<number | undefined> {
    try {
      return (await stat(path)).mtimeMs
    } catch {
      return undefined
    }
  },
}

export async function probeTreeActivity(
  root: string,
  cutoffMs: number,
  depth: number = MAX_AGE_DEPTH,
  fs: AgeProbeFs = nodeAgeProbeFs,
): Promise<TreeActivity> {
  const rootMtime = await fs.mtimeMs(root)
  if (rootMtime !== undefined && rootMtime > cutoffMs) return "active"
  let dated = rootMtime !== undefined
  let budget = MAX_AGE_ENTRIES
  const pending: Array<{ readonly path: string; readonly depth: number }> = [{ path: root, depth }]
  while (pending.length > 0 && budget > 0) {
    const current = pending.pop()
    if (current === undefined) break
    let entries: readonly AgeProbeEntry[]
    try {
      entries = await fs.list(current.path)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (budget <= 0) break
      budget -= 1
      const child = join(current.path, entry.name)
      const stamp = await fs.mtimeMs(child)
      if (stamp !== undefined) {
        if (stamp > cutoffMs) return "active"
        dated = true
      }
      if (entry.directory && current.depth > 1) pending.push({ path: child, depth: current.depth - 1 })
    }
  }
  return dated ? "idle" : "unknown"
}
