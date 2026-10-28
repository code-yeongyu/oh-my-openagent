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
 * Native realpath receives the original component sequence before lexical normalization:
 * on POSIX a symlink must be followed before a later `..`. Callers that open a lexically
 * resolved path must pass that same resolved path; raw-string openers must pass the raw path.
 * Windows compares normalized long names case-insensitively; POSIX compares native spelling
 * (so a case alias of the same directory on a case-insensitive volume is accepted).
 * Import from @oh-my-opencode/utils/path-containment.
 */
export function isPathInside(child: string, parent: string, options: PathContainmentOptions = {}): boolean {
  return containedRelativePath(child, parent, options) !== undefined
}

/** The canonical child's path relative to the canonical parent ("" for the parent itself), or undefined when outside. */
export function containedRelativePath(child: string, parent: string, options: PathContainmentOptions = {}): string | undefined {
  const paths = (options.platform ?? process.platform) === "win32" ? win32 : posix
  const realpath = options.realpath ?? realpathSync.native
  const canonicalChild = paths.normalize(realpath(child))
  const canonicalParent = paths.normalize(realpath(parent))
  const relative = paths.relative(canonicalParent, canonicalChild)
  const escapes = relative === ".." || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative)
  return escapes ? undefined : relative
}
