import type { ThreadDataError } from "../contracts"
import { isThreadErrorCode, threadToolFailure } from "../errors"
import { farExtensionRequest, type FarAnswer } from "../remote/far-request"
import type { JsonObject, RemoteThreadSurface } from "../remote/ports"
import type { ThreadWorktree, WorktreeOutcome, WorktreeRequest } from "./thread-worktree"
import { folderFailure } from "./failures"
import { THREAD_WORKTREE_RPC } from "./worktree-rpc-name"

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const unsupported = (device: string, message: string, next: string, details: JsonObject = {}): ThreadDataError => ({
  kind: "error",
  error: threadToolFailure("unsupported", message, next, { device, ...details }),
})

// The far handler's answer is data from another process: only a well-formed worktree or a typed failure passes.
function farOutcome(data: JsonObject, device: string): WorktreeOutcome {
  const worktree = data["worktree"]
  if (data["kind"] === "ok" && isObject(worktree)) {
    const { path, branch, base, repository } = worktree
    if ([path, branch, base, repository].every((field) => typeof field === "string"))
      return { kind: "ok", worktree: worktree as ThreadWorktree }
  }
  const error = data["error"]
  if (data["kind"] === "error" && isObject(error) && isThreadErrorCode(error["code"]))
    return {
      kind: "error",
      error: threadToolFailure(error["code"], String(error["message"]), String(error["next_action"]), {
        ...(isObject(error["details"]) ? error["details"] : {}),
        device,
      }),
    }
  return unsupported(
    device,
    `Device ${device} answered the worktree request with an unexpected reply.`,
    "Update omo on that device.",
  )
}

/** One worktree request to another device's omo (`farExtensionRequest`, `omo.thread.worktree`, `worktree-rpc.ts`). */
const farWorktreeRequest = (
  remote: RemoteThreadSurface,
  device: string,
  cwd: string,
  request: JsonObject,
): Promise<FarAnswer> =>
  farExtensionRequest(remote, device, cwd, THREAD_WORKTREE_RPC, request, {
    message: `omo on device ${device} cannot create worktrees yet.`,
    next: "Update omo on that device, then retry.",
  })

/** Creates a thread's worktree on another device (`farWorktreeRequest`). */
export async function prepareRemoteWorktree(
  remote: RemoteThreadSurface,
  device: string,
  cwd: string,
  request: WorktreeRequest,
): Promise<WorktreeOutcome> {
  const answer = await farWorktreeRequest(remote, device, cwd, { cwd, ...request })
  if (answer.kind !== "answered") return answer
  const result = farOutcome(answer.data, device)
  if (result.kind !== "ok" || answer.leftOpen === undefined) return result
  return { kind: "ok", worktree: { ...result.worktree, setup_session_left_open: answer.leftOpen } }
}

/**
 * Removes the worktree `prepareRemoteWorktree` made on `device` for a thread whose open then failed (#13450 review).
 * Answers undefined once that device confirms it removed the worktree and its branch; otherwise a `partial_commit`
 * failure naming the path and branch left there.
 */
export async function removeRemoteWorktree(
  remote: RemoteThreadSurface,
  device: string,
  worktree: ThreadWorktree,
): Promise<ThreadDataError | undefined> {
  const answer = await farWorktreeRequest(remote, device, worktree.repository, {
    remove: { path: worktree.path, branch: worktree.branch },
  })
  if (answer.kind === "answered" && answer.data["kind"] === "removed") return undefined
  const cause = answer.kind === "answered" ? farOutcome(answer.data, device) : answer
  return folderFailure("worktree_left_behind", `The worktree made on device ${device} could not be removed.`, {
    device,
    path: worktree.path,
    branch: worktree.branch,
    repository: worktree.repository,
    ...(cause.kind === "error" ? { cause: cause.error.code } : {}),
  })
}
