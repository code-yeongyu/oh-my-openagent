import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { posix, win32 } from "node:path"

/**
 * macOS autofs triggers (`auto_home`, `-hosts`) in every spelling that reaches the same mount: the root symlinks and their
 * firmlinked data-volume paths. Compared lowercase because the default APFS volume is case-insensitive (#11545).
 */
const DARWIN_AUTOMOUNT_TRIGGERS = ["/home", "/net", "/system/volumes/data/home", "/system/volumes/data/net"]

export interface AutomountTriggerOptions {
  readonly platform?: NodeJS.Platform
  /** The current user's home; its own subtree has already resolved its trigger, so it stays resolvable. */
  readonly homeDir?: string
}

/**
 * Whether resolving `path` (realpath, lstat or stat of it or anything under it) would force a macOS automount.
 * When the automounter is wedged that `open(2)` never returns and parks the calling thread, so no timer or
 * promise deadline can bound it (#11545, senpi#4542/#4543). Decided from the string alone, before any syscall:
 * true only on darwin, only for `/home`, `/net` or a path under them, and never for the user's own home subtree.
 * Callers treat such a path as an opaque lexical string. Linux, where `/home` is a real directory, is unchanged.
 */
export function isDarwinAutomountTriggerPath(path: string, options: AutomountTriggerOptions = {}): boolean {
  if ((options.platform ?? process.platform) !== "darwin") return false
  const lexical = posix.resolve(path).toLowerCase()
  if (!DARWIN_AUTOMOUNT_TRIGGERS.some((trigger) => lexical === trigger || lexical.startsWith(`${trigger}/`))) return false
  const home = posix.resolve(options.homeDir ?? homedir()).toLowerCase()
  return home === "/" || !(lexical === home || lexical.startsWith(`${home}/`))
}

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
