import { lstatSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"

/** @param {string} cacheRoot @param {string} currentRoot @param {{ uid: number, io: { lstat?: typeof lstatSync } }} security */
export function prunePluginCaches(cacheRoot, currentRoot, security) {
  const previous = []
  for (const name of readdirSync(cacheRoot)) {
    if (!/^[a-f0-9]{64}$/.test(name)) continue
    const path = join(cacheRoot, name)
    if (path === currentRoot) continue
    let stat
    try {
      stat = (security.io.lstat ?? lstatSync)(path)
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue
      throw error
    }
    if (!stat.isDirectory() || stat.uid !== security.uid || (stat.mode & 0o7777) !== 0o700) continue
    previous.push({ path, mtimeMs: stat.mtimeMs })
  }
  previous.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path))
  for (const { path } of previous.slice(1)) rmSync(path, { recursive: true, force: true })
}
