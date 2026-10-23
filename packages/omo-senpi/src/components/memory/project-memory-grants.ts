import { lstatSync, realpath, realpathSync } from "@oh-my-opencode/memory-core/fs"
import { containedRelativePath, type PathContainmentOptions } from "@oh-my-opencode/utils/path-containment"
import * as path from "node:path"

import type { MemoryIdentityContext } from "./context"

// Read-only exceptions to the cross-identity memory denial (#10044). A bound identity may READ the
// committed notes of a project identity the project-scope resolver found inside its session's
// working tree, and only after that resolver returned it. Enumeration, writes, the repo directory
// itself, its git metadata and reserved `system/` tree, and every other identity stay denied. The
// check runs on the canonical path, so a symlink committed into a granted repo cannot reach out of it.
const grants = new WeakMap<MemoryIdentityContext, Set<string>>()

// Compared case-insensitively on every platform: a `.GIT` or `System` entry in a memory repo is
// never note content, and on a case-insensitive volume it is the real git metadata.
const EXCLUDED_TOP_LEVEL = [".git", "system"]

export interface ProjectMemoryGrantOptions {
  /** Canonicalizes the repo; the tool-result path passes its session's memoized lookup. */
  readonly realPath?: (path: string) => Promise<string | undefined>
  /** Checked after canonicalizing: a session that shut down meanwhile is never granted. */
  readonly stillLive?: () => boolean
}

export async function grantProjectMemoryRead(context: MemoryIdentityContext, projectRepo: string, options: ProjectMemoryGrantOptions = {}): Promise<void> {
  const root = await (options.realPath ?? canonicalAsync)(projectRepo)
  if (root === undefined || options.stillLive?.() === false) return
  let roots = grants.get(context)
  if (roots === undefined) {
    roots = new Set()
    grants.set(context, roots)
  }
  roots.add(root)
}

export function revokeProjectMemoryReads(context: MemoryIdentityContext): void {
  grants.delete(context)
}

export function isGrantedProjectMemoryRead(context: MemoryIdentityContext, target: string, options: PathContainmentOptions = {}): boolean {
  const roots = grants.get(context)
  if (roots === undefined || roots.size === 0) return false
  const windows = (options.platform ?? process.platform) === "win32"
  const paths = windows ? path.win32 : path.posix
  const canonicalPath = options.realpath ?? realpathSync.native
  // A note that does not exist yet stays readable (the read reports it missing); only its existing
  // ancestors are resolved, so a symlink on the way is still followed before the comparison.
  const resolvedTarget = paths.resolve(target)
  const resolve = (input: string) => input === resolvedTarget ? canonicalAllowingMissing(input, canonicalPath, paths) : canonicalPath(input)
  for (const root of roots) {
    try {
      // Roots are stored canonical; a root that now resolves elsewhere was replaced (for example by a
      // symlink into a third identity) and is no longer the repo the resolver granted.
      if (!samePath(canonicalPath(root), root, paths, windows)) continue
      const rel = containedRelativePath(target, root, { ...options, realpath: resolve })
      if (rel === undefined || rel === "") continue
      const first = rel.split(paths.sep)[0] ?? ""
      if (EXCLUDED_TOP_LEVEL.includes(first.toLowerCase())) continue
      return true
    } catch {
      // An absent or unreadable path is not a read grant; never trust a lexical fallback.
      continue
    }
  }
  return false
}

function samePath(left: string, right: string, paths: typeof path.posix, windows: boolean): boolean {
  const a = paths.normalize(left)
  const b = paths.normalize(right)
  return windows ? a.toLowerCase() === b.toLowerCase() : a === b
}

function canonicalAllowingMissing(input: string, canonicalPath: (path: string) => string, paths: typeof path.posix): string {
  try {
    return canonicalPath(input)
  } catch (error) {
    const parent = paths.dirname(input)
    // A dangling link is an entry, not a missing note: its target could appear outside the repo later.
    if (!isMissingPathError(error) || parent === input || isEntry(input)) throw error
    return paths.join(canonicalAllowingMissing(parent, canonicalPath, paths), paths.basename(input))
  }
}

function isEntry(input: string): boolean {
  try {
    lstatSync(input)
    return true
  } catch {
    return false
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")
}

async function canonicalAsync(path: string): Promise<string | undefined> {
  try {
    return await realpath(path)
  } catch {
    return undefined
  }
}
