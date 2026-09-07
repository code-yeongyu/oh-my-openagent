import type { Dirent } from "node:fs"
import { lstat, readdir, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { fileExistsStrict, isNodeErrorWithCode } from "./codex-cache-fs"
// Windows refuses to unlink a mapped image, so pruning a cache entry whose runtime is still alive
// fails outright: node reports EPERM and bun reports EACCES, and neither retries. A leftover MCP
// server or daemon from the previous cache is the normal state of a machine being updated in use,
// so the removal waits for it the way renameWithRetry in codex-config-atomic-write.ts waits for a
// busy rename.
const REMOVE_RETRY_DELAYS_MS = [50, 100, 200, 400, 800] as const
const RETRIABLE_REMOVE_CODES = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"])

async function removeWithRetry(path: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      if (!isRetriableRemoveError(error) || attempt >= REMOVE_RETRY_DELAYS_MS.length) throw error
      await delay(REMOVE_RETRY_DELAYS_MS[attempt] ?? 0)
    }
  }
}

function isRetriableRemoveError(error: unknown): boolean {
  return isNodeErrorWithCode(error) && typeof error.code === "string" && RETRIABLE_REMOVE_CODES.has(error.code)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}


export async function pruneMarketplaceCache(input: {
  readonly codexHome: string
  readonly marketplaceName: string
  readonly keepPluginNames: readonly string[]
}): Promise<void> {
  const cacheRoot = join(input.codexHome, "plugins", "cache", input.marketplaceName)
  if (!(await fileExistsStrict(cacheRoot))) return
  const keep = new Set(input.keepPluginNames)
  const entries = await readCacheEntries(cacheRoot)
  for (const entry of entries) {
    if (!entry.isDirectory() || keep.has(entry.name)) continue
    await removeWithRetry(join(cacheRoot, entry.name))
  }
}

export async function pruneMarketplacePluginCaches(input: {
  readonly codexHome: string
  readonly marketplaceName: string
  readonly pluginNames: readonly string[]
}): Promise<void> {
  const cacheRoot = join(input.codexHome, "plugins", "cache", input.marketplaceName)
  if (!(await fileExistsStrict(cacheRoot))) return
  for (const pluginName of input.pluginNames) {
    await removeWithRetry(join(cacheRoot, pluginName))
  }
  const remainingEntries = await readCacheEntryNames(cacheRoot)
  if (remainingEntries.length === 0) {
    await removeWithRetry(cacheRoot)
  }
}

async function readCacheEntries(path: string): Promise<readonly Dirent<string>[]> {
  const emptyEntries: readonly Dirent<string>[] = []
  return readCacheRoot(path, () => readdir(path, { withFileTypes: true }), emptyEntries)
}

async function readCacheEntryNames(path: string): Promise<readonly string[]> {
  const emptyNames: readonly string[] = []
  return readCacheRoot(path, () => readdir(path), emptyNames)
}

async function readCacheRoot<T>(path: string, readEntries: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await readEntries()
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") return fallback
    if (await isBrokenCacheSymlink(path)) return fallback
    throw error
  }
}

async function isBrokenCacheSymlink(path: string): Promise<boolean> {
  try {
    const entry = await lstat(path)
    if (!entry.isSymbolicLink()) return false
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") return true
    throw error
  }

  try {
    await stat(path)
    return false
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") return true
    throw error
  }
}
