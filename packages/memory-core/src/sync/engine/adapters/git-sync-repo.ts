// SyncRepo over the memory repo's git, through memory-core's own exec boundary. The sync commit
// is built with plumbing so it never depends on a clean tree: the tree is HEAD plus exactly the
// rendered paths, assembled in a private index; the commit is authored `OmO Sync`; HEAD moves by
// compare-and-swap (`update-ref <new> <old>`), so an agent commit landing meanwhile is kept and
// the sync is rebuilt on top of it; finally only the committed paths' index entries are synced.
// A person's uncaptured edits elsewhere stay dirty and unstaged.

import { randomBytes } from "node:crypto"
import { join } from "node:path"

import { existsSync, mkdir, rm } from "../../../fs/resilient"
import { createNodeGitExec, type GitExec } from "../../../git/exec"
import type { SyncRepo } from "../ports"

const SYNC_AUTHOR = { name: "OmO Sync", email: "sync@omo.invalid" }
const TIMEOUT_MS = 60_000
const CAS_ATTEMPTS = 5
/** Reconciliation looks for its trailer among recent history only. */
const TRAILER_SCAN = 1_000

export class SyncCommitError extends Error {
  override readonly name = "SyncCommitError"
}

export interface GitSyncRepoOptions {
  readonly root: string
  readonly exec?: GitExec
}

export function createGitSyncRepo(options: GitSyncRepoOptions): SyncRepo {
  const { root } = options
  const exec = options.exec ?? createNodeGitExec()
  const gitDir = join(root, ".git")
  const run = async (argv: readonly string[], env?: NodeJS.ProcessEnv, stdin?: string): Promise<string> => {
    const result = await exec.run(argv, { cwd: root, timeoutMs: TIMEOUT_MS, ...(env === undefined ? {} : { env: { ...process.env, ...env } }), ...(stdin === undefined ? {} : { stdin }) })
    if (result.code !== 0) throw new SyncCommitError(`git ${argv[0]} failed (${result.code}): ${result.stderr.trim()}`)
    return result.stdout.trim()
  }
  const head = async (): Promise<string | null> => {
    const result = await exec.run(["rev-parse", "--verify", "-q", "HEAD"], { cwd: root, timeoutMs: TIMEOUT_MS })
    return result.code === 0 ? result.stdout.trim() : null
  }
  const treeOnto = async (parent: string | null, paths: readonly string[]): Promise<string> => {
    const dir = join(gitDir, "omo-sync")
    const index = join(dir, `index.${randomBytes(6).toString("hex")}`)
    const env = { GIT_INDEX_FILE: index }
    await mkdir(dir, { recursive: true })
    try {
      await run(parent === null ? ["read-tree", "--empty"] : ["read-tree", parent], env)
      // A path on disk is staged as is; a missing one is removed from the index if tracked and is a
      // no-op otherwise. `git add` on a path in neither HEAD nor the working tree exits 128, which
      // once wedged a device that received a create and a delete of a file it never had.
      const present: string[] = []
      const missing: string[] = []
      for (const path of paths) (existsSync(join(root, path)) ? present : missing).push(path)
      if (present.length > 0) await run(["add", "-A", "--", ...present], env)
      if (missing.length > 0) await run(["rm", "--cached", "-q", "--ignore-unmatch", "--", ...missing], env)
      return await run(["write-tree"], env)
    } finally {
      await rm(index, { force: true })
    }
  }
  return {
    root,
    gitDir,
    head,
    headTree: () => run(["rev-parse", "HEAD^{tree}"]),
    stageTree: async (paths) => treeOnto(await head(), paths),
    async commit(paths, message) {
      const author = {
        GIT_AUTHOR_NAME: SYNC_AUTHOR.name,
        GIT_AUTHOR_EMAIL: SYNC_AUTHOR.email,
        GIT_COMMITTER_NAME: SYNC_AUTHOR.name,
        GIT_COMMITTER_EMAIL: SYNC_AUTHOR.email,
      }
      for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
        const parent = await head()
        const tree = await treeOnto(parent, paths)
        const commit = await run(["commit-tree", tree, ...(parent === null ? [] : ["-p", parent]), "-F", "-"], author, message)
        const moved = await exec.run(["update-ref", "-m", "omo-sync", "HEAD", commit, parent ?? "0".repeat(40)], { cwd: root, timeoutMs: TIMEOUT_MS })
        if (moved.code !== 0) continue
        if (paths.length > 0) await run(["reset", "-q", "HEAD", "--", ...paths])
        return commit
      }
      throw new SyncCommitError(`HEAD kept moving; the sync commit was not recorded after ${CAS_ATTEMPTS} attempts`)
    },
    async hasSyncCommit(range) {
      if ((await head()) === null) return false
      const trailers = await run(["log", `-${TRAILER_SCAN}`, "--format=%(trailers:key=Sync-Seq,valueonly)", "HEAD"])
      return trailers.split("\n").includes(range)
    },
  }
}
