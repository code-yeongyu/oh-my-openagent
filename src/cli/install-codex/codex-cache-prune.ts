import { readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { exists } from "./codex-cache-fs"

export async function pruneMarketplaceCache(input: {
  readonly codexHome: string
  readonly marketplaceName: string
  readonly keepPluginNames: readonly string[]
}): Promise<void> {
  const cacheRoot = join(input.codexHome, "plugins", "cache", input.marketplaceName)
  if (!(await exists(cacheRoot))) return
  const keep = new Set(input.keepPluginNames)
  const entries = await readdir(cacheRoot, { withFileTypes: true })
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
  if (!(await exists(cacheRoot))) return
  for (const pluginName of input.pluginNames) {
    await rm(join(cacheRoot, pluginName), { recursive: true, force: true })
  }
  if ((await readdir(cacheRoot)).length === 0) {
    await rm(cacheRoot, { recursive: true, force: true })
  }
}
