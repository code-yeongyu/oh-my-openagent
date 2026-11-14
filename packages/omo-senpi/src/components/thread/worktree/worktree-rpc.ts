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

/**
 * Undoes a worktree this device made for a thread whose open then failed: only a folder inside this device's worktrees
 * root whose checked-out branch is the one named, so a far caller cannot remove anything else.
 */
async function removeRequested(record: Record<string, unknown>, root: string, git: GitRun): Promise<WorktreeRemoval> {
  const path = optionalString(record["path"])
  const branch = optionalString(record["branch"])
  if (typeof path !== "string" || !isAbsolute(path) || typeof branch !== "string") return notAbsolute(path)
  if (!(await insideRoot(root, path)))
    return folderFailure("worktree_left_behind", `${path} is not a worktree OmO made here; it was not removed.`, { path, branch })
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
