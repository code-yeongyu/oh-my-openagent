// On-disk footprint of one memory identity: the size/health metric behind /doctor and the maintenance
// log. Areas map onto the storage layout so a reader sees which store grew. The walk is async and capped
// in entries, so it never stalls the event loop or runs unbounded on a pathological store.

import { join } from "node:path"

import { lstat, readdir } from "../fs/resilient"
import type { MemoryIdentityPaths } from "../identity"

/** The whole identity store should stay well under this; above it /doctor warns. */
export const MEMORY_FOOTPRINT_WARN_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_ENTRIES = 200_000

export type MemoryFootprintArea = "repo" | "transcripts" | "facts" | "reflection" | "worktrees" | "recall" | "other"

export type MemoryFootprint = {
  readonly totalBytes: number
  readonly areas: Readonly<Record<MemoryFootprintArea, number>>
  readonly files: number
  /** True when the entry cap stopped the walk: totals are then lower bounds. */
  readonly truncated: boolean
}

function areaOf(paths: MemoryIdentityPaths, dir: string): MemoryFootprintArea {
  const within = (root: string): boolean => dir === root || dir.startsWith(`${root}/`) || dir.startsWith(`${root}\\`)
  if (within(paths.repo)) return "repo"
  if (within(paths.transcripts)) return "transcripts"
  if (within(paths.factsQueue) || within(paths.facts)) return "facts"
  if (within(paths.worktrees)) return "worktrees"
  if (within(paths.reflection) || within(paths.reflectionSessions)) return "reflection"
  if (within(paths.recall)) return "recall"
  return "other"
}

export async function measureMemoryFootprint(
  paths: MemoryIdentityPaths,
  options: { readonly maxEntries?: number } = {},
): Promise<MemoryFootprint> {
  const areas: Record<MemoryFootprintArea, number> = { repo: 0, transcripts: 0, facts: 0, reflection: 0, worktrees: 0, recall: 0, other: 0 }
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  let files = 0
  let seen = 0
  let truncated = false
  const pending: string[] = [paths.root]
  while (pending.length > 0) {
    const dir = pending.pop()
    if (dir === undefined) break
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (seen >= maxEntries) {
        truncated = true
        break
      }
      seen += 1
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        pending.push(path)
      } else if (entry.isFile()) {
        const info = await lstat(path).catch(() => undefined)
        if (info === undefined) continue
        files += 1
        areas[areaOf(paths, dir)] += info.size
      }
    }
    if (truncated) break
  }
  const totalBytes = Object.values(areas).reduce((total, bytes) => total + bytes, 0)
  return { totalBytes, areas, files, truncated }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}

/** One line: total plus every non-empty area, largest first. */
export function formatMemoryFootprint(footprint: MemoryFootprint): string {
  const parts = Object.entries(footprint.areas)
    .filter(([, bytes]) => bytes > 0)
    .sort(([, left], [, right]) => right - left)
    .map(([area, bytes]) => `${area} ${formatBytes(bytes)}`)
  const total = `${formatBytes(footprint.totalBytes)}${footprint.truncated ? "+" : ""}`
  return parts.length === 0 ? total : `${total} (${parts.join(", ")})`
}
