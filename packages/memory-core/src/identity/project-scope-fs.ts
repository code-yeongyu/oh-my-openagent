// Filesystem view of the project-scope resolver (#10044): asynchronous and memoized per session.
//
// The resolver runs on every successful read/edit/write tool result, so it must never block the
// event loop. Every answer it needs (real path, entry kind, small file text) is loaded once through
// `fs/promises` and kept for the session. The resolver's path logic stays synchronous code over the
// settled answers: an answer not loaded yet throws `ProbeMiss`, `settle` awaits that one load and
// runs the logic again. Answers are pure functions of the filesystem, so a rerun reaches the same
// point with one more answer known, and a directory already resolved costs no filesystem call.

import { lstat, readFile, readdir, realpath, stat } from "../fs/resilient"
import type { GitEntryKind, GitLayoutProbe } from "./git-layout"
import type { DirectoryProbe } from "./resolve"

interface EntryStats {
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
}

/** The asynchronous filesystem calls the resolver makes; injectable so tests can count them. */
export interface ProjectScopeFs {
  readonly realpath: (path: string) => Promise<string>
  readonly lstat: (path: string) => Promise<EntryStats>
  readonly stat: (path: string) => Promise<EntryStats>
  readonly readFile: (path: string, encoding: "utf8") => Promise<string>
  readonly readdir: (path: string) => Promise<string[]>
}

export const defaultProjectScopeFs: ProjectScopeFs = {
  realpath: (path) => realpath(path),
  lstat: (path) => lstat(path),
  stat: (path) => stat(path),
  readFile: (path, encoding) => readFile(path, encoding),
  readdir: (path) => readdir(path),
}

export type EntryKind = "directory" | "file" | "symlink" | "other"

class ProbeMiss extends Error {
  constructor(readonly loaded: Promise<unknown>) {
    super("project scope probe answer not loaded yet")
  }
}

class Memo<T> {
  private readonly settled = new Map<string, { readonly value: T }>()
  private readonly pending = new Map<string, Promise<T>>()

  constructor(private readonly load: (key: string) => Promise<T>) {}

  async get(key: string): Promise<T> {
    const hit = this.settled.get(key)
    if (hit !== undefined) return hit.value
    let pending = this.pending.get(key)
    if (pending === undefined) {
      pending = this.load(key).then((value) => {
        this.settled.set(key, { value })
        this.pending.delete(key)
        return value
      })
      this.pending.set(key, pending)
    }
    return await pending
  }

  now(key: string): T {
    const hit = this.settled.get(key)
    if (hit !== undefined) return hit.value
    throw new ProbeMiss(this.get(key))
  }
}

async function kindOf(read: () => Promise<EntryStats>): Promise<EntryKind | undefined> {
  try {
    const stats = await read()
    if (stats.isSymbolicLink()) return "symlink"
    if (stats.isDirectory()) return "directory"
    return stats.isFile() ? "file" : "other"
  } catch {
    // Missing or unreadable: no entry the resolver could follow.
    return undefined
  }
}

async function orUndefined<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read()
  } catch {
    // Unreadable answers "unknown", which every caller treats as "not here".
    return undefined
  }
}

export interface ProjectScopeProbe extends DirectoryProbe {
  readonly gitLayout: GitLayoutProbe
  /** Settled answers only; throws `ProbeMiss` (handled by `settle`) for one not loaded yet. */
  realPath(path: string): string | undefined
  linkKind(path: string): EntryKind | undefined
  realPathAsync(path: string): Promise<string | undefined>
  linkKindAsync(path: string): Promise<EntryKind | undefined>
  readdir(path: string): Promise<string[] | undefined>
}

export function createProjectScopeProbe(fs: ProjectScopeFs = defaultProjectScopeFs): ProjectScopeProbe {
  const real = new Memo((path) => orUndefined(() => fs.realpath(path)))
  const link = new Memo((path) => kindOf(() => fs.lstat(path)))
  const target = new Memo((path) => kindOf(() => fs.stat(path)))
  const text = new Memo((path) => orUndefined(() => fs.readFile(path, "utf8")))
  const gitLayout: GitLayoutProbe = {
    entryKind(path): GitEntryKind | undefined {
      const kind = target.now(path)
      return kind === "directory" || kind === "file" ? kind : undefined
    },
    readText: (path) => text.now(path),
    realPath: (path) => real.now(path),
  }
  return {
    exists: (path) => target.now(path) !== undefined,
    gitLayout,
    realPath: (path) => real.now(path),
    linkKind: (path) => link.now(path),
    realPathAsync: (path) => real.get(path),
    linkKindAsync: (path) => link.get(path),
    readdir: (path) => orUndefined(() => fs.readdir(path)),
  }
}

/** Runs synchronous probe logic to completion, loading each missing answer asynchronously. */
export async function settle<T>(run: () => T): Promise<T> {
  for (;;) {
    try {
      return run()
    } catch (error) {
      if (!(error instanceof ProbeMiss)) throw error
      await error.loaded
    }
  }
}
