import { realpathSync } from "@oh-my-opencode/memory-core/fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

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

export function grantProjectMemoryRead(context: MemoryIdentityContext, projectRepo: string): void {
  const root = canonical(projectRepo)
  if (root === undefined) return
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

export function isGrantedProjectMemoryRead(context: MemoryIdentityContext, target: string): boolean {
  const roots = grants.get(context)
  if (roots === undefined || roots.size === 0) return false
  const resolved = canonicalTarget(target)
  if (resolved === undefined) return false
  for (const root of roots) {
    const rel = relative(root, resolved)
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) continue
    const first = rel.split(sep)[0] ?? ""
    if (EXCLUDED_TOP_LEVEL.includes(first.toLowerCase())) continue
    return true
  }
  return false
}

function canonical(path: string): string | undefined {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

// A file that does not exist yet has no real path: canonicalize its nearest existing ancestor.
function canonicalTarget(target: string): string | undefined {
  let current = resolve(target)
  const suffix: string[] = []
  for (;;) {
    const real = canonical(current)
    if (real !== undefined) return suffix.length === 0 ? real : join(real, ...suffix.reverse())
    const parent = dirname(current)
    if (parent === current) return undefined
    suffix.push(current.slice(parent.length).replace(/^[\\/]+/, ""))
    current = parent
  }
}
