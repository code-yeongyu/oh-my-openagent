// Project-scoped memory (#10044): which memory identity owns a file a session touches.
//
// A session binds one identity, derived from its working directory. A file under a child project
// that has its own auto identity belongs to that identity's memory. Candidates are looked up only
// inside the session's scope roots: the session's own root (never a candidate itself), plus the
// real target of every directory symlink inside the session's tree that is not part of a git work
// tree (a workspace linking its projects in, `projects/omo -> /Volumes/.../omo`). A touched path is
// judged by where it really is, so the same project is found through the symlink or by its real
// path. In `git` mode a linked worktree path is mapped onto its main checkout first, the same way
// session binding maps it. Nothing is created: only identities whose repo already exists count.

import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

import { existsSync, lstatSync, readdirSync, realpathSync } from "../fs/resilient"
import { resolveLinkedWorktreeSource } from "./git-layout"
import { MEMORY_ROOT_ENV_VAR, resolveMemoryRoot } from "./layout"
import { resolveAutoIdentity, type AutoIdentityMode, type MemoryIdentity } from "./resolve"

export interface ProjectIdentity {
  readonly projectDir: string
  readonly identity: MemoryIdentity
}

export interface ProjectIdentityResolverOptions {
  readonly sessionCwd: string
  /** The session's resolved absolute memory root: a relative `OMO_MEMORY_HOME` must not resolve per candidate directory. */
  readonly memoryRoot?: string
  /** The `auto_identity` mode the session was bound with. */
  readonly autoIdentity?: AutoIdentityMode
  /** The session's own identity, never returned. */
  readonly boundId?: string
  readonly env?: Record<string, string | undefined>
  readonly exists?: (path: string) => boolean
}

export interface ProjectIdentityResolver {
  forPath(filePath: string): ProjectIdentity | undefined
}

/** Bounds the one-time scan of the session's tree for linked-in projects. */
export const PROJECT_SCOPE_SCAN_LIMIT = 1_000

function isInsideOrEqual(dir: string, root: string): boolean {
  const rel = relative(root, dir)
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
}

function realPathOrResolved(path: string): string {
  let current = resolve(path)
  const missing: string[] = []
  for (;;) {
    try {
      return join(realpathSync.native(current), ...missing.reverse())
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolve(path)
      missing.push(basename(current))
      current = parent
    }
  }
}

function isDirectorySymlink(path: string): boolean {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false
    return lstatSync(realpathSync.native(path)).isDirectory()
  } catch {
    // A dangling or unreadable link leads nowhere a project could live.
    return false
  }
}

// A symlink committed inside a repository is that repository's content, not a linked-in project.
function isInsideGitWorkTree(dir: string): boolean {
  for (let current = resolve(dir); ; current = dirname(current)) {
    if (existsSync(join(current, ".git"))) return true
    if (dirname(current) === current) return false
  }
}

export function createProjectIdentityResolver(options: ProjectIdentityResolverOptions): ProjectIdentityResolver {
  const sessionCwd = resolve(options.sessionCwd)
  const sessionRoot = realPathOrResolved(sessionCwd)
  const env = options.memoryRoot === undefined ? (options.env ?? process.env) : { ...(options.env ?? process.env), [MEMORY_ROOT_ENV_VAR]: options.memoryRoot }
  const mode = options.autoIdentity ?? "path"
  const exists = options.exists ?? existsSync
  const homeRoot = realPathOrResolved(homedir())
  const memoryRootReal = realPathOrResolved(options.memoryRoot ?? resolveMemoryRoot(env, sessionCwd))
  const linkedRoots = new Set<string>()
  const checkedLinks = new Set<string>()
  const byDir = new Map<string, ProjectIdentity | null>()
  let scanned = false

  function considerLink(link: string): void {
    if (checkedLinks.has(link)) return
    checkedLinks.add(link)
    if (!isDirectorySymlink(link) || isInsideGitWorkTree(dirname(link))) return
    const target = realPathOrResolved(link)
    if (isTooBroadRoot(target)) return
    linkedRoots.add(target)
  }

  // A link to the session root or above, to the home directory or above, or to anything holding the
  // memory root would pull every project on the machine into scope (`ln -s ~ x`): only a link that
  // names a project's own tree counts.
  function isTooBroadRoot(target: string): boolean {
    if (isInsideOrEqual(sessionRoot, target)) return true
    if (isInsideOrEqual(homeRoot, target)) return true
    return isInsideOrEqual(memoryRootReal, target)
  }

  function scanSessionTree(): void {
    if (scanned) return
    scanned = true
    let budget = PROJECT_SCOPE_SCAN_LIMIT
    const visit = (dir: string, depth: number): void => {
      let names: string[]
      try {
        names = readdirSync(dir)
      } catch {
        // An unreadable directory holds no linked project we could read either.
        return
      }
      for (const name of names) {
        if (budget <= 0) return
        budget -= 1
        const path = join(dir, name)
        considerLink(path)
        if (depth > 1) continue
        try {
          if (lstatSync(path).isDirectory()) visit(path, depth + 1)
        } catch {
          // Vanished between readdir and lstat: nothing to scan.
        }
      }
    }
    if (!isInsideGitWorkTree(sessionCwd)) visit(sessionCwd, 1)
  }

  // A touched path spelled through a symlink names its own link even past the scan's depth.
  function linksAlong(lexicalDir: string): void {
    if (!isInsideOrEqual(lexicalDir, sessionCwd)) return
    const parts = relative(sessionCwd, lexicalDir).split(sep).filter((part) => part !== "")
    let current = sessionCwd
    for (const part of parts) {
      current = join(current, part)
      considerLink(current)
    }
  }

  function canonicalDir(lexicalDir: string): string {
    const real = realPathOrResolved(lexicalDir)
    if (mode !== "git") return real
    const linked = resolveLinkedWorktreeSource(real)
    return linked === undefined ? real : realPathOrResolved(linked.hashSource)
  }

  function deepestRoot(dir: string): { readonly root: string; readonly candidate: boolean } | undefined {
    let best: { root: string; candidate: boolean } | undefined
    for (const root of linkedRoots) {
      if (isInsideOrEqual(dir, root) && (best === undefined || root.length > best.root.length)) best = { root, candidate: true }
    }
    if (isInsideOrEqual(dir, sessionRoot) && (best === undefined || sessionRoot.length > best.root.length)) {
      best = { root: sessionRoot, candidate: false }
    }
    return best
  }

  function identityAt(dir: string): ProjectIdentity | null {
    const cached = byDir.get(dir)
    if (cached !== undefined) return cached
    const identity = resolveAutoIdentity(dir, env, mode, { exists })
    const found = identity.id !== options.boundId && exists(identity.paths.repo) ? { projectDir: dir, identity } : null
    byDir.set(dir, found)
    return found
  }

  return {
    forPath(filePath) {
      const lexicalDir = dirname(resolve(sessionCwd, filePath))
      scanSessionTree()
      linksAlong(lexicalDir)
      const dir = canonicalDir(lexicalDir)
      const scope = deepestRoot(dir)
      if (scope === undefined) return undefined
      for (let current = dir; ; current = dirname(current)) {
        if (current === scope.root && !scope.candidate) return undefined
        const found = identityAt(current)
        if (found !== null) return found
        if (current === scope.root || dirname(current) === current) return undefined
      }
    },
  }
}
