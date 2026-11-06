import { groupDirectories } from "./external-projection-dirs"
import type { ExternalProjectionLimits } from "./external-projection-limits"
import { NAME_LEGEND, NAME_NOTE, directoryItems, type ProjectionItem } from "./external-projection-names"

// The renderer loads lazily through `#memory-external-projection` (see compile.ts); the limits stay eager.
export { DEFAULT_EXTERNAL_PROJECTION_LIMITS, type ExternalProjectionLimits } from "./external-projection-limits"

const MEMORY_DIR = "$MEMORY_DIR"
const OPEN = "<external_projection>"
const CLOSE = "</external_projection>"

export interface ExternalProjectionInput {
  /** Last commit time per path (epoch seconds); names without one sort after every timed name. */
  readonly times: ReadonlyMap<string, number>
  readonly limits: ExternalProjectionLimits
  /** Commit times could not be read, so names are in name order instead of newest first. */
  readonly recencyUnavailable?: boolean
  /** Why the commit times could not be read, when `recencyUnavailable`. */
  readonly recencyError?: string
}

export interface ExternalProjectionStats {
  readonly shown: number
  readonly omitted: number
  readonly bytes: number
  readonly maxBytes: number
  /** No listing fits the budget, so the smallest one was emitted. */
  readonly overflow: boolean
  readonly recencyUnavailable: boolean
}

interface DirectoryListing {
  readonly label: string
  readonly pointer: string
  readonly items: readonly ProjectionItem[]
  readonly itemBytes: readonly number[]
}

interface Layout {
  readonly rootBare: boolean
  /** Some line folds or groups names, so the block opens with the full legend instead of the short note. */
  readonly legend: boolean
  readonly directories: readonly DirectoryListing[]
  readonly allowances: readonly number[]
}

export function renderExternalProjection(paths: readonly string[], input?: ExternalProjectionInput): string {
  return render(layout(paths, input))
}

export function renderExternalProjectionStats(
  paths: readonly string[],
  input: ExternalProjectionInput,
): ExternalProjectionStats {
  const fitted = layout(paths, input)
  const bytes = Buffer.byteLength(render(fitted))
  const total = fitted.directories.reduce((sum, directory) => sum + files(directory.items), 0)
  const shown = fitted.directories.reduce((sum, directory, index) => sum + files(directory.items.slice(0, fitted.allowances[index] ?? 0)), 0)
  const { maxBytes } = input.limits
  return {
    shown,
    omitted: total - shown,
    bytes,
    maxBytes,
    overflow: maxBytes > 0 && bytes > maxBytes,
    recencyUnavailable: input.recencyUnavailable === true,
  }
}

function layout(paths: readonly string[], input: ExternalProjectionInput | undefined): Layout {
  const limits = input?.limits ?? { maxEntriesPerDirectory: 0, maxBytes: 0 }
  const bounded = limits.maxEntriesPerDirectory > 0 || limits.maxBytes > 0
  const groups = groupDirectories(paths, bounded ? input?.times : undefined)
  const directories = groups.map((group): DirectoryListing => {
    const items = directoryItems(group.files)
    return { label: group.label, pointer: group.pointer, items, itemBytes: items.map((item) => Buffer.byteLength(item.text)) }
  })
  const cap = limits.maxEntriesPerDirectory
  const allowances = directories.map((directory) => cap > 0 ? Math.min(cap, directory.items.length) : directory.items.length)
  const rootBare = !groups.some((group) => group.label === `${MEMORY_DIR}/`)
  const legend = groups.some((group) => group.grouped) || directories.some((directory) => directory.items.some((item) => item.files > 1))
  if (limits.maxBytes > 0) fitToBudget(directories, allowances, limits.maxBytes, rootBare, legend)
  return { rootBare, legend, directories, allowances }
}

function files(items: readonly ProjectionItem[]): number {
  return items.reduce((sum, item) => sum + item.files, 0)
}

/**
 * Shrinks the directory showing the most names by one until the block fits, so large directories give up
 * names first and ties rotate in listing order. Never drops a directory line; when even the floor
 * (every allowance zero) is over budget, the caller reports the overflow.
 */
function fitToBudget(directories: readonly DirectoryListing[], allowances: number[], maxBytes: number, rootBare: boolean, legend: boolean): void {
  const lineBytes = (index: number, allowance = allowances[index] ?? 0): number => {
    const directory = directories[index]
    if (directory === undefined) return 0
    let size = Buffer.byteLength(`${directory.label}: `)
    for (let shown = 0; shown < allowance; shown++) size += (directory.itemBytes[shown] ?? 0) + (shown > 0 ? 2 : 0)
    const omitted = files(directory.items.slice(allowance))
    if (omitted > 0) size += (allowance > 0 ? 1 : 0) + Buffer.byteLength(marker(omitted, directory.pointer))
    return size
  }
  const start = [...allowances]
  const lines = directories.map((_, index) => lineBytes(index))
  const fixedLines = 3 + (rootBare ? 1 : 0)
  const fixedBytes = Buffer.byteLength(OPEN) + Buffer.byteLength(legend ? NAME_LEGEND : NAME_NOTE) + Buffer.byteLength(CLOSE) + (rootBare ? Buffer.byteLength(`${MEMORY_DIR}/`) : 0)
  let total = fixedBytes + lines.reduce((sum, size) => sum + size, 0) + (fixedLines + directories.length - 1)
  while (total > maxBytes) {
    let widest = -1
    for (let index = 0; index < allowances.length; index++) {
      if ((allowances[index] ?? 0) > (allowances[widest] ?? 0)) widest = index
    }
    if (widest === -1) break
    allowances[widest] = (allowances[widest] ?? 0) - 1
    const before = lines[widest] ?? 0
    lines[widest] = lineBytes(widest)
    total += (lines[widest] ?? 0) - before
  }
  if (total <= maxBytes) return
  // An omitted-names marker can cost more than the names it replaces, so widest-first shrinking can
  // miss the smallest listing. Lines are independent: each directory at its own smallest line is the
  // true minimum, which may still fit; ties keep more names.
  start.forEach((limit, index) => {
    let best = limit
    for (let allowance = limit - 1; allowance >= 0; allowance--) {
      if (lineBytes(index, allowance) < lineBytes(index, best)) best = allowance
    }
    allowances[index] = best
  })
}

function render({ rootBare, legend, directories, allowances }: Layout): string {
  const lines = [OPEN, legend ? NAME_LEGEND : NAME_NOTE]
  if (rootBare) lines.push(`${MEMORY_DIR}/`)
  directories.forEach((directory, index) => {
    const allowance = allowances[index] ?? directory.items.length
    const shown = directory.items.slice(0, allowance).map((item) => item.text).join(", ")
    const omitted = files(directory.items.slice(allowance))
    const suffix = omitted > 0 ? `${shown ? " " : ""}${marker(omitted, directory.pointer)}` : ""
    lines.push(`${directory.label}: ${shown}${suffix}`)
  })
  lines.push(CLOSE)
  return lines.join("\n")
}

function marker(omitted: number, pointer: string): string {
  return `(+${omitted} more; read ${pointer} to list)`
}
