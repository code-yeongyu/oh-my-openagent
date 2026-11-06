import { lstatSync, realpathSync, statSync } from "node:fs"
import type { Stats } from "node:fs"
import { dirname, isAbsolute, join, parse, sep } from "node:path"

/**
 * Resolve a write destination physically, including new parents. Never collapse
 * `link/..` textually: the parent is taken only after the link has been followed.
 * The returned absolute path must also be the path handed to the executor.
 */
export function resolveFileWritePath(filePath: string, cwd: string, followFinalSymlink = true): string {
  // Both separators split the walk on every platform: a `/`-spelled tail left whole on win32 went
  // through path.win32.join, which collapses `..` lexically before any link is followed (#11541).
  const input = filePath.replace(/[\\/]/g, sep)
  const absolute = isAbsolute(input) ? input : `${realpathSync.native(cwd)}${sep}${input}`
  const root = parse(absolute).root
  let current = realpathSync.native(root)
  let directory = true

  const components = absolute.slice(root.length).split(sep).filter(Boolean)
  for (let index = 0; index < components.length; index++) {
    const component = components[index]
    if (!directory) throw new Error(`Not a directory: ${current}`)
    if (component === ".") continue
    if (component === "..") {
      current = dirname(current)
      continue
    }
    const next = join(current, component)
    // Unlink/rename acts on the named directory entry, not its symlink target.
    if (!followFinalSymlink && index === components.length - 1) return next
    let entry: Stats
    try {
      entry = lstatSync(next)
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
      current = next
      continue
    }
    // A dangling link must fail here, not become a new-file ENOENT fallback.
    current = realpathSync.native(next)
    directory = entry.isSymbolicLink() ? statSync(current).isDirectory() : entry.isDirectory()
  }
  return current
}
