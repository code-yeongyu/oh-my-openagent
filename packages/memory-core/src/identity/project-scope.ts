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
// Lookups run on the tool-result path, so every filesystem answer comes from the asynchronous,
// per-session memo in `project-scope-fs.ts`; no call here touches the filesystem synchronously.

import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

import { resolveMemoryRoot, MEMORY_ROOT_ENV_VAR } from "./layout"
import { resolveLinkedWorktreeSource } from "./git-layout"
import { createProjectScopeProbe, settle, type ProjectScopeFs } from "./project-scope-fs"
import { resolveAutoIdentity, type AutoIdentityMode, type MemoryIdentity } from "./resolve"

export type { ProjectScopeFs } from "./project-scope-fs"

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
  readonly fs?: ProjectScopeFs
}

export interface ProjectIdentityResolver {
  /** The first call resolves the session's roots and scans its tree; later calls reuse both. */
  forPath(filePath: string): Promise<ProjectIdentity | undefined>
  /** The memoized real path, `undefined` when it cannot be resolved. */
  realPath(path: string): Promise<string | undefined>
}

/** Bounds the one-time scan of the session's tree for linked-in projects. */
export const PROJECT_SCOPE_SCAN_LIMIT = 1_000

interface ScopeRoots {
  readonly session: string
  readonly home: string
  readonly memory: string
}

function isInsideOrEqual(dir: string, root: string): boolean {
  const rel = relative(root, dir)
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
}

export function createProjectIdentityResolver(options: ProjectIdentityResolverOptions): ProjectIdentityResolver {
  const sessionCwd = resolve(options.sessionCwd)
  const env = options.memoryRoot === undefined ? (options.env ?? process.env) : { ...(options.env ?? process.env), [MEMORY_ROOT_ENV_VAR]: options.memoryRoot }
  const mode = options.autoIdentity ?? "path"
  const probe = createProjectScopeProbe(options.fs)
  const linkedRoots = new Set<string>()
  const checkedLinks = new Set<string>()
  const byDir = new Map<string, ProjectIdentity | null>()
  let prepared: Promise<ScopeRoots> | undefined

  function realPathOrResolved(path: string): string {
    let current = resolve(path)
    const missing: string[] = []
    for (;;) {
      const real = probe.realPath(current)
      if (real !== undefined) return join(real, ...missing.reverse())
      const parent = dirname(current)
      if (parent === current) return resolve(path)
      missing.push(basename(current))
      current = parent
    }
  }

  // A dangling or unreadable link leads nowhere a project could live.
  function isDirectorySymlink(path: string): boolean {
    if (probe.linkKind(path) !== "symlink") return false
    const target = probe.realPath(path)
    return target !== undefined && probe.linkKind(target) === "directory"
  }

  // A symlink committed inside a repository is that repository's content, not a linked-in project.
  function isInsideGitWorkTree(dir: string): boolean {
    for (let current = resolve(dir); ; current = dirname(current)) {
      if (probe.exists(join(current, ".git"))) return true
      if (dirname(current) === current) return false
    }
  }

  // Probes first, records after: `settle` reruns this until every answer is loaded.
  function considerLink(link: string, scope: ScopeRoots): void {
    if (checkedLinks.has(link)) return
    const target = isDirectorySymlink(link) && !isInsideGitWorkTree(dirname(link)) ? realPathOrResolved(link) : undefined
    checkedLinks.add(link)
    if (target !== undefined && !isTooBroadRoot(target, scope)) linkedRoots.add(target)
  }

  // A link to the session root or above, to the home directory or above, or to anything holding the
  // memory root would pull every project on the machine into scope (`ln -s ~ x`): only a link that
  // names a project's own tree counts.
  function isTooBroadRoot(target: string, scope: ScopeRoots): boolean {
    return isInsideOrEqual(scope.session, target) || isInsideOrEqual(scope.home, target) || isInsideOrEqual(scope.memory, target)
  }

  async function scanSessionTree(scope: ScopeRoots): Promise<void> {
    if (await settle(() => isInsideGitWorkTree(sessionCwd))) return
    let budget = PROJECT_SCOPE_SCAN_LIMIT
    const visit = async (dir: string, depth: number): Promise<void> => {
      // An unreadable directory holds no linked project we could read either.
      const names = await probe.readdir(dir)
      for (const name of names ?? []) {
        if (budget <= 0) return
        budget -= 1
        const path = join(dir, name)
        const kind = await probe.linkKindAsync(path)
        await settle(() => considerLink(path, scope))
        if (depth === 1 && kind === "directory") await visit(path, depth + 1)
      }
    }
    await visit(sessionCwd, 1)
  }

  async function prepareOnce(): Promise<ScopeRoots> {
    const scope = await settle(() => ({
      session: realPathOrResolved(sessionCwd),
      home: realPathOrResolved(homedir()),
      memory: realPathOrResolved(options.memoryRoot ?? resolveMemoryRoot(env, sessionCwd)),
    }))
    await scanSessionTree(scope)
    return scope
  }

  // A touched path spelled through a symlink names its own link even past the scan's depth.
  function linksAlong(lexicalDir: string, scope: ScopeRoots): void {
    if (!isInsideOrEqual(lexicalDir, sessionCwd)) return
    const parts = relative(sessionCwd, lexicalDir).split(sep).filter((part) => part !== "")
    let current = sessionCwd
    for (const part of parts) {
      current = join(current, part)
      considerLink(current, scope)
    }
  }

  function canonicalDir(lexicalDir: string): string {
    const real = realPathOrResolved(lexicalDir)
    if (mode !== "git") return real
    const linked = resolveLinkedWorktreeSource(real, probe.gitLayout)
    return linked === undefined ? real : realPathOrResolved(linked.hashSource)
  }

  function deepestRoot(dir: string, sessionRoot: string): { readonly root: string; readonly candidate: boolean } | undefined {
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
    const identity = resolveAutoIdentity(dir, env, mode, probe)
    const found = identity.id !== options.boundId && probe.exists(identity.paths.repo) ? { projectDir: dir, identity } : null
    byDir.set(dir, found)
    return found
  }

  function lookup(lexicalDir: string, scope: ScopeRoots): ProjectIdentity | undefined {
    linksAlong(lexicalDir, scope)
    const dir = canonicalDir(lexicalDir)
    const owner = deepestRoot(dir, scope.session)
    if (owner === undefined) return undefined
    for (let current = dir; ; current = dirname(current)) {
      if (current === owner.root && !owner.candidate) return undefined
      const found = identityAt(current)
      if (found !== null) return found
      if (current === owner.root || dirname(current) === current) return undefined
    }
  }

  return {
    async forPath(filePath) {
      prepared ??= prepareOnce()
      const scope = await prepared
      const lexicalDir = dirname(resolve(sessionCwd, filePath))
      return await settle(() => lookup(lexicalDir, scope))
    },
    realPath: (path) => probe.realPathAsync(path),
  }
}
