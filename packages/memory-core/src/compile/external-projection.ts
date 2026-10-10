import { redactSecretLikeMaterial } from "../sync/redact"

const MEMORY_DIR = "$MEMORY_DIR"
const OPEN = "<external_projection>"
const CLOSE = "</external_projection>"

/** `0` disables a limit; both at `0` reproduces the unbounded, name-ordered listing byte for byte. */
export interface ExternalProjectionLimits {
  readonly maxEntriesPerDirectory: number
  readonly maxBytes: number
}

export interface ExternalProjectionInput {
  /** Last commit time per path (epoch seconds); names without one sort after every timed name. */
  readonly times: ReadonlyMap<string, number>
  readonly limits: ExternalProjectionLimits
  /** Commit times could not be read, so names are in name order instead of newest first. */
  readonly recencyUnavailable?: boolean
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

export const DEFAULT_EXTERNAL_PROJECTION_LIMITS: ExternalProjectionLimits = {
  maxEntriesPerDirectory: 40,
  maxBytes: 24_576,
}

interface DirectoryListing {
  readonly label: string
  readonly pointer: string
  readonly names: readonly string[]
  readonly nameBytes: readonly number[]
}

interface Layout {
  readonly rootBare: boolean
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
  const total = fitted.directories.reduce((sum, directory) => sum + directory.names.length, 0)
  const shown = fitted.allowances.reduce((sum, allowance) => sum + allowance, 0)
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
  const byDirectory = new Map<string, Array<{ readonly name: string; readonly path: string }>>()
  for (const path of paths) {
    const parts = path.split("/").filter(Boolean)
    const name = parts.pop()
    if (name === undefined) continue
    const directory = parts.length > 0 ? `${parts.join("/")}/` : ""
    const entries = byDirectory.get(directory)
    if (entries) entries.push({ name, path })
    else byDirectory.set(directory, [{ name, path }])
  }
  const keys = [...byDirectory.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b))
  if (byDirectory.has("")) keys.unshift("")
  const directories = keys.map((directory): DirectoryListing => {
    const entries = [...(byDirectory.get(directory) ?? [])]
    const times = input?.times
    entries.sort((a, b) => {
      if (bounded && times !== undefined) {
        const delta = (times.get(b.path) ?? Number.NEGATIVE_INFINITY) - (times.get(a.path) ?? Number.NEGATIVE_INFINITY)
        if (delta !== 0 && !Number.isNaN(delta)) return delta
      }
      return a.name.localeCompare(b.name)
    })
    const names = entries.map((entry) => redactSecretLikeMaterial(entry.name))
    const parts = directory.split("/").filter(Boolean)
    const safe = directory === "" ? "" : `${parts.map(redactSecretLikeMaterial).join("/")}/`
    const readable = parts.slice(0, firstRedacted(parts))
    return {
      label: directory === "" ? `${MEMORY_DIR}/` : safe,
      pointer: `${MEMORY_DIR}/${readable.length === 0 ? "" : `${readable.join("/")}/`}`,
      names,
      nameBytes: names.map((name) => Buffer.byteLength(name)),
    }
  })
  const cap = limits.maxEntriesPerDirectory
  const allowances = directories.map((directory) => cap > 0 ? Math.min(cap, directory.names.length) : directory.names.length)
  const rootBare = !byDirectory.has("")
  if (limits.maxBytes > 0) fitToBudget(directories, allowances, limits.maxBytes, rootBare)
  return { rootBare, directories, allowances }
}

/**
 * Shrinks the directory showing the most names by one until the block fits, so large directories give up
 * names first and ties rotate in listing order. Never drops a directory line; when even the floor
 * (every allowance zero) is over budget, the caller reports the overflow.
 */
function fitToBudget(directories: readonly DirectoryListing[], allowances: number[], maxBytes: number, rootBare: boolean): void {
  const lineBytes = (index: number, allowance = allowances[index] ?? 0): number => {
    const directory = directories[index]
    if (directory === undefined) return 0
    let size = Buffer.byteLength(`${directory.label}: `)
    for (let shown = 0; shown < allowance; shown++) size += (directory.nameBytes[shown] ?? 0) + (shown > 0 ? 2 : 0)
    const omitted = directory.names.length - allowance
    if (omitted > 0) size += (allowance > 0 ? 1 : 0) + Buffer.byteLength(marker(omitted, directory.pointer))
    return size
  }
  const start = [...allowances]
  const lines = directories.map((_, index) => lineBytes(index))
  const fixedLines = 2 + (rootBare ? 1 : 0)
  const fixedBytes = Buffer.byteLength(OPEN) + Buffer.byteLength(CLOSE) + (rootBare ? Buffer.byteLength(`${MEMORY_DIR}/`) : 0)
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

function render({ rootBare, directories, allowances }: Layout): string {
  const lines = [OPEN]
  if (rootBare) lines.push(`${MEMORY_DIR}/`)
  directories.forEach((directory, index) => {
    const allowance = allowances[index] ?? directory.names.length
    const shown = directory.names.slice(0, allowance).join(", ")
    const omitted = directory.names.length - allowance
    const suffix = omitted > 0 ? `${shown ? " " : ""}${marker(omitted, directory.pointer)}` : ""
    lines.push(`${directory.label}: ${shown}${suffix}`)
  })
  lines.push(CLOSE)
  return lines.join("\n")
}

function firstRedacted(parts: readonly string[]): number {
  const index = parts.findIndex((part) => redactSecretLikeMaterial(part) !== part)
  return index === -1 ? parts.length : index
}

function marker(omitted: number, pointer: string): string {
  return `(+${omitted} more; read ${pointer} to list)`
}
