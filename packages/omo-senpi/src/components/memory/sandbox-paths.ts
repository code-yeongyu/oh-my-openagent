import { accessSync, constants, existsSync, realpathSync } from "node:fs"
import { basename, delimiter, dirname, isAbsolute, join } from "node:path"

/**
 * Canonicalizes as much of the path as exists and re-joins the remaining segments.
 *
 * The sandbox is built BEFORE the reflection child runs, and several granted entries
 * (runtime/reflection, runtime/reflection-sessions, the resolved agent dir, XDG_CONFIG_HOME)
 * legitimately do not exist yet on a fresh machine or a first reflection. A bare realpathSync
 * throws `ENOENT ... lstat '<first missing ancestor>'` there, which surfaced as a pre-spawn
 * `spawn_failed` and stalled the reflection cursor.
 *
 * Only the existing prefix is resolved through the filesystem; the absent tail is appended
 * verbatim, so the grant always names the full intended path and can never widen to an ancestor.
 */
export function canonicalPath(path: string): string {
  const segments: string[] = []
  let current = path
  for (;;) {
    if (existsSync(current)) return join(realpathSync(current), ...segments.reverse())
    const parent = dirname(current)
    if (parent === current) return path
    segments.push(basename(current))
    current = parent
  }
}

export function canonicalAbsentPath(path: string): string {
  return join(canonicalPath(dirname(path)), basename(path))
}

export function defaultWhich(command: string): string | undefined {
  const found = firstExecutableOnPath(command, process.env.PATH)
  if (found !== undefined) return found
  if (command === "sandbox-exec" && existsSync("/usr/bin/sandbox-exec")) return "/usr/bin/sandbox-exec"
  return undefined
}

export function resolveInnerCommand(command: string, env: NodeJS.ProcessEnv): string | undefined {
  if (isAbsolute(command)) return command
  return firstExecutableOnPath(command, env.PATH)
}

function firstExecutableOnPath(command: string, path: string | undefined): string | undefined {
  for (const entry of (path ?? "").split(delimiter)) {
    if (entry === "") continue
    const candidate = join(entry, command)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not executable on this PATH entry; keep scanning.
    }
  }
  return undefined
}
