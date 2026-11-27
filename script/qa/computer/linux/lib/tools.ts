// Where a session's host tools live. PATH first, then the private program directories the
// distributions use for helpers no image puts on PATH (Debian, Ubuntu and Fedora install
// at-spi-bus-launcher under /usr/libexec; older Debian under /usr/lib/at-spi2-core).
import { accessSync, constants, statSync } from "node:fs"
import { join } from "node:path"

const LIBEXEC_DIRS: readonly string[] = ["/usr/libexec", "/usr/lib/at-spi2-core", "/usr/lib"]

export interface ToolLookup {
  readonly which: (tool: string) => string | null
  readonly libexecDirs: readonly string[]
}

const HOST: ToolLookup = { which: (tool) => Bun.which(tool), libexecDirs: LIBEXEC_DIRS }

function executable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The absolute path `tool` runs from, or null when this host has it nowhere. */
export function resolveTool(tool: string, lookup: ToolLookup = HOST): string | null {
  const onPath = lookup.which(tool)
  if (onPath !== null) return onPath
  return lookup.libexecDirs.map((dir) => join(dir, tool)).find(executable) ?? null
}
