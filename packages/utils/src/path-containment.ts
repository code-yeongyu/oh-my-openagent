import { realpathSync } from "node:fs"
import { posix, win32 } from "node:path"

export interface PathContainmentOptions {
  readonly platform?: NodeJS.Platform
  /** Native filesystem realpath lookup; injected only for alternate filesystems/tests. */
  readonly realpath?: (path: string) => string
}

/**
 * Includes the parent itself. Both paths must exist: native realpath errors propagate,
 * so callers must map an unresolvable path to their denied/not-inside outcome.
 * Mirrors Senpi canonicalizePathStrict (#1463, 5d78ba39d).
 * Guarantee: each path is first resolved lexically (`path.resolve`, which collapses `..`
 * textually), then canonicalized with the native realpath, and the verdict is about that
 * resolved path. A caller must OPEN the same `path.resolve`d path it checked (Senpi's
 * built-in tools do). Opening the raw string instead can reach a different file on POSIX,
 * where the kernel follows a symlink before applying a later `..`.
 * Windows compares normalized long names case-insensitively; POSIX preserves case.
 * Import from @oh-my-opencode/utils/path-containment.
 */
export function isPathInside(child: string, parent: string, options: PathContainmentOptions = {}): boolean {
  return containedRelativePath(child, parent, options) !== undefined
}

/** The canonical child's path relative to the canonical parent ("" for the parent itself), or undefined when outside. */
export function containedRelativePath(child: string, parent: string, options: PathContainmentOptions = {}): string | undefined {
  const paths = (options.platform ?? process.platform) === "win32" ? win32 : posix
  const realpath = options.realpath ?? realpathSync.native
  const canonicalChild = paths.normalize(realpath(paths.resolve(child)))
  const canonicalParent = paths.normalize(realpath(paths.resolve(parent)))
  const relative = paths.relative(canonicalParent, canonicalChild)
  const escapes = relative === ".." || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative)
  return escapes ? undefined : relative
}
