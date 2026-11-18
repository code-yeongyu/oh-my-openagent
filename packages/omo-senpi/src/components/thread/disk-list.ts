import { readdirSync, statSync } from "node:fs"
import { basename, join } from "node:path"

import { readDiskSession, sessionDirectoryPrefix, type DiskSession } from "./address-book"

/** How many session files one `thread_list` reads for its inactive rows: the newest by file time. */
const DISK_LIST_MAX_SESSIONS = 200

/**
 * How many session files one `thread_list` stats to rank by modification time: the newest by file name. A session file
 * is named `<creation time>_<id>.jsonl`, so the name orders files by creation, and the listing never stats a whole
 * session history (every workspace with `all_scope`) on each call.
 */
const DISK_LIST_MAX_STATS = 1000

export type ListDiskSessionsOptions = {
  /** Every workspace's session directories; otherwise only those of `workspaceRoots`. */
  readonly all_scope?: boolean
  readonly workspaceRoots?: readonly string[]
}

type SessionFile = { readonly path: string; readonly modified: number }

function sessionPathsIn(directory: string): string[] {
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(directory, name))
  } catch {
    return []
  }
}

function statSessionFile(path: string): SessionFile[] {
  try {
    const stat = statSync(path)
    return stat.isFile() ? [{ path, modified: stat.mtimeMs }] : []
  } catch {
    return []
  }
}

/**
 * The session files a listing shows as inactive threads (a thread its engine closed stays listed): the session
 * directories of the caller's workspace (every workspace with `all_scope`): of the DISK_LIST_MAX_STATS newest files by
 * name (creation time), the newest by modification time first, at most DISK_LIST_MAX_SESSIONS of them read, each
 * through `readSessionFacts` (two bounded windows). `truncated` says more files were there.
 */
export function listDiskSessions(
  sessionsDir: string,
  opts: ListDiskSessionsOptions = {},
): { readonly sessions: DiskSession[]; readonly truncated: boolean } {
  let projectDirs: string[]
  try {
    projectDirs = readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && /^--.*--$/.test(entry.name))
      .map((entry) => entry.name)
  } catch {
    return { sessions: [], truncated: false }
  }
  const prefixes = opts.all_scope === true ? undefined : (opts.workspaceRoots ?? []).map(sessionDirectoryPrefix)
  const paths = projectDirs
    .filter((dir) => prefixes === undefined || prefixes.some((prefix) => dir.startsWith(prefix)))
    .flatMap((dir) => sessionPathsIn(join(sessionsDir, dir)))
    .sort((left, right) => basename(right).localeCompare(basename(left)) || left.localeCompare(right))
  const files = paths
    .slice(0, DISK_LIST_MAX_STATS)
    .flatMap(statSessionFile)
    .sort((left, right) => right.modified - left.modified || left.path.localeCompare(right.path))
  const sessions = files.slice(0, DISK_LIST_MAX_SESSIONS).flatMap((file) => {
    const session = readDiskSession(file.path, null)
    return session === null ? [] : [session]
  })
  return { sessions, truncated: paths.length > DISK_LIST_MAX_SESSIONS }
}
