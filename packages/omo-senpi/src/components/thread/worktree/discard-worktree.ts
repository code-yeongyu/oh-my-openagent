import { realpath, rm, rmdir, stat } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import type { ThreadDataError } from "../contracts"
import { folderFailure } from "./failures"
import type { GitRun } from "./thread-worktree"

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path)
  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)
}

/** Whether `path` lies in the worktrees root, by spelling and, once it exists, by realpath (no symlink escapes). */
export async function insideRoot(root: string, path: string): Promise<boolean> {
  if (!isAbsolute(path) || !inside(resolve(root), resolve(path))) return false
  const realRoot = await realpath(root).catch(() => resolve(root))
  return !(await exists(path)) || inside(realRoot, await realpath(path))
}

/**
 * Undoes a worktree THIS call created (#13450 review): \`git worktree remove --force\` (a locked worktree stays), the
 * folder only when git does not know it as a worktree (a checkout git abandoned mid-add) and it lies in the worktrees
 * root, then the branch, then the per-repository folder when this call made it and it is empty. What remains is named
 * in a \`partial_commit\` failure (\`worktree_left_behind\`) so the agent can remove it; nothing else is touched.
 */
export async function discardWorktree(options: {
  readonly repository: string
  readonly path: string
  readonly branch: string
  readonly root: string
  readonly git: GitRun
  readonly createdFolder?: string
  /** Only a create that checked `path` was absent before its add may delete a folder git does not know as a worktree. */
  readonly removeUnregisteredFolder?: boolean
}): Promise<ThreadDataError | undefined> {
  const { repository, path, branch, root, git } = options
  if (!(await insideRoot(root, path)))
    return folderFailure("worktree_left_behind", `${path} is outside OmO's worktrees folder; it was not removed.`, { path, branch })
  const registered = async (): Promise<boolean> => {
    const list = await git(["worktree", "list", "--porcelain"], repository)
    // git prints the realpath (e.g. /private/tmp on macOS); either spelling counts, so a locked worktree is never rm'd.
    const spellings = new Set([path, await realpath(path).catch(() => path)])
    return list.exit !== 0 || list.stdout.split("\n").some((line) => spellings.has(line.slice("worktree ".length)))
  }
  if (await exists(path)) await git(["worktree", "remove", "--force", path], repository)
  if (options.removeUnregisteredFolder === true && (await exists(path)) && !(await registered()))
    await rm(path, { recursive: true, force: true }).catch(() => {})
  await git(["worktree", "prune"], repository)
  const hasBranch = async () => (await git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repository)).exit === 0
  if ((await hasBranch()) && !(await registered())) await git(["branch", "-D", branch], repository)
  if (options.createdFolder !== undefined) await rmdir(options.createdFolder).catch(() => {})
  const left = { folder: await exists(path), branch: await hasBranch() }
  if (!left.folder && !left.branch) return undefined
  return folderFailure("worktree_left_behind", `The worktree this call created could not be fully removed.`, {
    path,
    branch,
    repository,
    left,
  })
}
