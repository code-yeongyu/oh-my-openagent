import { realpath } from "node:fs/promises"
import { basename, dirname, isAbsolute } from "node:path"
import type { SenpiExtensionAPI } from "../../../extension/types"
import type { ThreadDataError } from "../contracts"
import { discardWorktree, insideRoot } from "./discard-worktree"
import { folderFailure } from "./failures"
import { createThreadWorktree, runGit, type GitRun, type WorktreeOutcome } from "./thread-worktree"

/** The \`extension_request\` another device's thread_create sends this device's omo to create (or undo) a worktree here. */
export const THREAD_WORKTREE_RPC = "omo.thread.worktree"

export type WorktreeRemoval = { readonly kind: "removed" } | ThreadDataError

const optionalString = (value: unknown): string | undefined | false =>
  value === undefined ? undefined : typeof value === "string" && value.length > 0 ? value : false
const recordOf = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
const notAbsolute = (path: unknown): ThreadDataError =>
  folderFailure("relative_path", "The worktree request must name an absolute folder of this device.", {
    ...(typeof path === "string" ? { path } : {}),
  })

const realOrUndefined = (path: string): Promise<string | undefined> => realpath(path).catch(() => undefined)

/**
 * Whether `path` is itself the top folder of a linked worktree (#13450 review): git's toplevel run there is the same
 * folder, and its repository lists it as a worktree other than the main one. A subfolder of a worktree, a folder of an
 * enclosing repository (an agent dir inside a git-tracked home) or a main checkout is none.
 */
async function isLinkedWorktreeTop(path: string, git: GitRun): Promise<boolean> {
  const real = await realOrUndefined(path)
  const top = await git(["rev-parse", "--show-toplevel"], path)
  if (real === undefined || top.exit !== 0 || (await realOrUndefined(top.stdout.trim())) !== real) return false
  const list = await git(["worktree", "list", "--porcelain"], path)
  if (list.exit !== 0) return false
  const linked = list.stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .slice(1)
  const reals = await Promise.all(linked.map((line) => realOrUndefined(line.slice("worktree ".length))))
  return reals.includes(real)
}

/**
 * Undoes a worktree this device made for a thread whose open then failed: only the top folder of a linked worktree
 * inside this device's worktrees root whose checked-out branch is the one named, so a far caller cannot remove anything
 * else.
 */
async function removeRequested(record: Record<string, unknown>, root: string, git: GitRun): Promise<WorktreeRemoval> {
  const path = optionalString(record["path"])
  const branch = optionalString(record["branch"])
  if (typeof path !== "string" || !isAbsolute(path) || typeof branch !== "string") return notAbsolute(path)
  if (!(await insideRoot(root, path)))
    return folderFailure("worktree_left_behind", `${path} is not a worktree OmO made here; it was not removed.`, { path, branch })
  if (!(await isLinkedWorktreeTop(path, git)))
    return folderFailure("worktree_left_behind", `${path} is not the top folder of a worktree; it was not removed.`, {
      path,
      branch,
    })
  const head = await git(["symbolic-ref", "--short", "HEAD"], path)
  const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], path)
  if (head.exit !== 0 || head.stdout.trim() !== branch || common.exit !== 0)
    return folderFailure("worktree_left_behind", `${path} is not the worktree of branch ${branch}; it was not removed.`, {
      path,
      branch,
    })
  const commonDir = common.stdout.trim()
  const repository = basename(commonDir) === ".git" ? dirname(commonDir) : commonDir
  return (await discardWorktree({ repository, path, branch, root, git })) ?? { kind: "removed" }
}

export async function answerWorktreeRequest(
  data: unknown,
  root: string,
  git: GitRun = runGit,
): Promise<WorktreeOutcome | WorktreeRemoval> {
  const record = recordOf(data)
  if (record["remove"] !== undefined) return await removeRequested(recordOf(record["remove"]), root, git)
  const cwd = optionalString(record["cwd"])
  const branch = optionalString(record["branch"])
  const base = optionalString(record["base"])
  if (typeof cwd !== "string" || !isAbsolute(cwd) || branch === false || base === false) return notAbsolute(cwd)
  return await createThreadWorktree({
    repository: cwd,
    request: { ...(branch === undefined ? {} : { branch }), ...(base === undefined ? {} : { base }) },
    root,
    git,
  })
}

export function registerThreadWorktreeRpc(pi: SenpiExtensionAPI, root: () => string): void {
  pi.rpc?.handle?.(THREAD_WORKTREE_RPC, (data) => answerWorktreeRequest(data, root()))
}
