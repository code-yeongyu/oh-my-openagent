import { realpathSync, statSync } from "node:fs"
import { basename, dirname, join } from "node:path"

/**
 * The directory of `name` as the engine installed at `senpiRoot` resolves it: Node's
 * node_modules walk from senpi's real path. That one walk covers every install shape - a
 * bundled senpi keeps the dependency in its own `node_modules`, npm hoists it beside senpi,
 * and bun's isolated store links it beside senpi's real path in `.bun/<key>/node_modules` -
 * so no caller may assume where the dependency lives. Returns undefined when nothing on the
 * walk provides `name`.
 */
export function engineDependencyDir(senpiRoot, name) {
  let current = realpathSync(senpiRoot)
  while (true) {
    if (basename(current) !== "node_modules") {
      const candidate = join(current, "node_modules", name)
      if (statSync(candidate, { throwIfNoEntry: false })?.isDirectory()) return candidate
    }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}
