import type { Dirent } from "node:fs"
import { lstat, readdir, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { fileExistsStrict, isNodeErrorWithCode } from "./codex-cache-fs"

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
    await rm(join(cacheRoot, entry.name), { recursive: true, force: true })
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
    await rm(join(cacheRoot, pluginName), { recursive: true, force: true })
  }
  const remainingEntries = await readCacheEntryNames(cacheRoot)
  if (remainingEntries.length === 0) {
    await rm(cacheRoot, { recursive: true, force: true })
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
