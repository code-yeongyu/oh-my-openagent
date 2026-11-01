import { lstatSync, realpathSync } from "node:fs"
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
  // A caller that injects a resolver decides its own canonical form (the grant check allows a note that
  // does not exist yet), so only the default path is walked here.
  const canonicalChild = paths.normalize(
    options.realpath === undefined ? resolveSegmentwise(child, { ...options, allowMissing: false }) : options.realpath(child),
  )
  // The parent is walked too: a lexical `..` after a link names a directory the opener never reaches, and
  // a containment verdict inherits that error.
  const canonicalParent = paths.normalize(resolveSegmentwise(parent, { ...options, allowMissing: false }))
  const relative = paths.relative(canonicalParent, canonicalChild)
  const escapes = relative === ".." || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative)
  return escapes ? undefined : relative
}

export interface SegmentwiseResolveOptions extends PathContainmentOptions {
  readonly lstat?: (path: string) => { isDirectory(): boolean }
  /** When false, a remainder that does not exist throws instead of being returned verbatim. */
  readonly allowMissing?: boolean
}

/**
 * Canonicalizes `target` the way `open(2)` resolves it: symlinks expand one segment at a time, so a
 * `..` after a link climbs from the link's target, never from the literal string. `path.resolve` and
 * `realpathSync` collapse that `..` lexically first and name a different file, which let a symlink
 * inside a granted repo read a third identity's note while the containment check still said "inside".
 *
 * A remainder that does not exist yet keeps its segments verbatim, because a missing note stays
 * readable; `allowMissing: false` refuses it instead. A `.`, `..` or empty segment inside such a
 * remainder throws: collapsing it would once again name a path the opener never reaches. A relative
 * target is anchored at the canonical working directory, as `open(2)` anchors it.
 */
export function resolveSegmentwise(target: string, options: SegmentwiseResolveOptions = {}): string {
  const platform = options.platform ?? process.platform
  const realpath = options.realpath ?? realpathSync.native
  const lstat = options.lstat ?? lstatSync
  // Windows collapses dot segments before the kernel sees them, so the lexical path is what opens; the
  // existing prefix still resolves natively (8.3 short names included) and a missing remainder is appended.
  if (platform === "win32") return resolveWindowsLexical(target, realpath, lstat, options.allowMissing)

  const absolute = posix.isAbsolute(target) ? target : `${realpath(".")}/${target}`
  const root = posix.parse(absolute).root
  let resolved = root
  let missing: string[] | undefined
  for (const segment of absolute.split("/")) {
    if (missing !== undefined) {
      if (segment === "" || segment === "." || segment === "..") throw unresolvable(target)
      missing.push(segment)
      continue
    }
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      resolved = posix.dirname(resolved)
      continue
    }
    const candidate = posix.join(resolved, segment)
    try {
      resolved = realpath(candidate)
    } catch (error) {
      if ((error as { code?: unknown }).code !== "ENOENT") throw error
      // A dangling link is an entry, not a missing note: its target could appear outside the repo later.
      if (isEntry(candidate, lstat)) throw error
      // A missing remainder can only live under a directory.
      if (!lstat(resolved).isDirectory()) throw error
      if (options.allowMissing === false) throw unresolvable(target)
      missing = [segment]
    }
  }
  return missing === undefined ? resolved : posix.join(resolved, ...missing)
}

function unresolvable(target: string): Error {
  return Object.assign(new Error(`unresolvable remainder: ${target}`), { code: "ENOENT" })
}

function isEntry(input: string, lstat: (path: string) => unknown): boolean {
  try {
    lstat(input)
    return true
  } catch {
    return false
  }
}

function resolveWindowsLexical(
  target: string,
  realpath: (path: string) => string,
  lstat: (path: string) => { isDirectory(): boolean },
  allowMissing: boolean | undefined,
): string {
  const lexical = win32.resolve(target)
  const root = win32.parse(lexical).root
  const missing: string[] = []
  let current = lexical
  for (;;) {
    let ancestor: string
    try {
      ancestor = realpath(current)
    } catch (error) {
      if ((error as { code?: unknown }).code !== "ENOENT") throw error
      // A dangling link is an entry, not a missing note; the root itself always exists.
      if (isEntry(current, lstat) || current.length <= root.length) throw error
      missing.unshift(win32.basename(current))
      current = win32.dirname(current)
      continue
    }
    if (missing.length === 0) return ancestor
    if (!lstat(ancestor).isDirectory()) throw Object.assign(new Error(`not a directory: ${ancestor}`), { code: "ENOTDIR" })
    if (allowMissing === false) throw unresolvable(target)
    return win32.join(ancestor, ...missing)
  }
}
