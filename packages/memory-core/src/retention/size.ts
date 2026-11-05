// How many bytes an identity's runtime/ holds, counted the way `du` counts them (allocated blocks
// when the platform reports them, else the size), so the doctor number is the number the user sees
// on disk and the number the size cap acts on. Symlinks count as themselves and are never followed.

import { join } from "node:path"

import { lstat, readdir, type Stats } from "../fs/resilient"

export interface RuntimeStoreSize {
  readonly store: string
  readonly bytes: number
}

export interface RuntimeSize {
  readonly bytes: number
  /** Per store, largest first: `reflection/<x>` and `recall/<x>` are split, every other top entry is one store. */
  readonly stores: readonly RuntimeStoreSize[]
}

/** `memory.runtime.max_bytes` default per identity; `0` means unbounded. */
export const DEFAULT_RUNTIME_MAX_BYTES = 2 * 1024 * 1024 * 1024
/** Both doctor surfaces warn from this share of the cap on. */
const RUNTIME_SIZE_WARN_RATIO = 0.8

export interface RuntimeSizeStanding {
  readonly level: "ok" | "warn"
  /** Whole percent of the cap, absent when the cap is unbounded. */
  readonly percent?: number
}

export function runtimeSizeStanding(bytes: number, maxBytes: number): RuntimeSizeStanding {
  if (maxBytes <= 0) return { level: "ok" }
  const percent = Math.floor((bytes / maxBytes) * 100)
  return { level: bytes >= maxBytes * RUNTIME_SIZE_WARN_RATIO ? "warn" : "ok", percent }
}

export function formatRuntimeBytes(bytes: number): string {
  const units = ["KiB", "MiB", "GiB", "TiB"]
  if (bytes < 1024) return `${bytes} B`
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}

const SPLIT_STORES = new Set(["reflection", "recall"])

function chargedBytes(stats: Pick<Stats, "blocks" | "size">): number {
  const blocks = stats.blocks
  if (typeof blocks === "number" && Number.isFinite(blocks) && (blocks > 0 || stats.size === 0)) return blocks * 512
  return stats.size
}

function isGone(error: unknown): boolean {
  const code = error instanceof Error && "code" in error ? error.code : undefined
  return code === "ENOENT" || code === "ENOTDIR"
}

async function lstatOrUndefined(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    if (isGone(error)) return undefined
    throw error
  }
}

async function namesOf(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch (error) {
    if (isGone(error)) return []
    throw error
  }
}

/**
 * Bytes under `path`, the entry itself included; entries removed while walking count as zero. A fired
 * `signal` (the pass deadline) aborts the walk between entries.
 */
export async function measureTreeBytes(path: string, signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted()
  const stats = await lstatOrUndefined(path)
  if (stats === undefined) return 0
  let bytes = chargedBytes(stats)
  if (!stats.isDirectory()) return bytes
  for (const name of await namesOf(path)) bytes += await measureTreeBytes(join(path, name), signal)
  return bytes
}

export interface RuntimeSizeUnknown {
  readonly budgetMs: number
  /** ISO time the measurement gave up. */
  readonly at: string
}

/**
 * The doctors' measurement (`/doctor` and `omo doctor`): {@link measureRuntimeSize} under a deadline of
 * `budgetMs` (or the caller's `signal`), so a huge tree reports "size unknown" instead of stalling.
 */
export async function measureRuntimeSizeWithinBudget(
  runtimeDir: string,
  input: { readonly budgetMs?: number; readonly signal?: AbortSignal; readonly now: number },
): Promise<{ readonly size: RuntimeSize } | { readonly sizeUnknown: RuntimeSizeUnknown }> {
  const signal = input.signal ?? (input.budgetMs === undefined ? undefined : AbortSignal.timeout(input.budgetMs))
  try {
    return { size: await measureRuntimeSize(runtimeDir, signal === undefined ? {} : { signal }) }
  } catch (error) {
    if (signal?.aborted !== true) throw error
    return { sizeUnknown: { budgetMs: input.budgetMs ?? 0, at: new Date(input.now).toISOString() } }
  }
}

export async function measureRuntimeSize(runtimeDir: string, options: { readonly signal?: AbortSignal } = {}): Promise<RuntimeSize> {
  const signal = options.signal
  signal?.throwIfAborted()
  const root = await lstatOrUndefined(runtimeDir)
  if (root === undefined) return { bytes: 0, stores: [] }
  let bytes = chargedBytes(root)
  const stores: RuntimeStoreSize[] = []
  if (root.isDirectory()) {
    for (const name of await namesOf(runtimeDir)) {
      const path = join(runtimeDir, name)
      const stats = await lstatOrUndefined(path)
      if (stats === undefined) continue
      if (stats.isDirectory() && SPLIT_STORES.has(name)) {
        bytes += chargedBytes(stats)
        for (const child of await namesOf(path)) {
          const childBytes = await measureTreeBytes(join(path, child), signal)
          bytes += childBytes
          stores.push({ store: `${name}/${child}`, bytes: childBytes })
        }
        continue
      }
      const storeBytes = await measureTreeBytes(path, signal)
      bytes += storeBytes
      stores.push({ store: name, bytes: storeBytes })
    }
  }
  stores.sort((left, right) => right.bytes - left.bytes || left.store.localeCompare(right.store))
  return { bytes, stores }
}
