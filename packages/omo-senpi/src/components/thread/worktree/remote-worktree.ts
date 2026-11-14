import type { ThreadDataError } from "../contracts"
import { closeLadder, SESSION_GONE, type RecordAnswer } from "../control/close-ladder"
import { openedEngineId, openRefusal } from "../control/open-reply"
import { ControlRefusal } from "../control/port"
import { isThreadErrorCode, threadToolFailure } from "../errors"
import { outcomeFailure } from "../remote/outcome"
import type { JsonObject, RemoteThreadSurface } from "../remote/ports"
import { replyData } from "../remote/remote-ops"
import type { ThreadWorktree, WorktreeOutcome, WorktreeRequest } from "./thread-worktree"
import { folderFailure } from "./failures"
import { THREAD_WORKTREE_RPC } from "./worktree-rpc"

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

type FarAnswer = { readonly kind: "answered"; readonly data: JsonObject; readonly leftOpen?: string } | ThreadDataError

/**
 * One worktree request to another device. The relay carries only engine records, so the device's own omo does the work:
 * a short-lived session opens in `cwd` there, its `extension_request` (`omo.thread.worktree`, `worktree-rpc.ts`) runs,
 * and the session is closed again (`leftOpen` names it when it would not close). A device whose omo predates the
 * request answers `unsupported` naming the update; a folder that is not there answers `folder_missing`.
 */
async function farWorktreeRequest(
  remote: RemoteThreadSurface,
  device: string,
  cwd: string,
  request: JsonObject,
): Promise<FarAnswer> {
  const opened = await remote.sessions.endpointCommand(
    device,
    { type: "open_session", retain_on_disconnect: true, cwd },
    { locate: true },
  )
  if (opened.kind !== "ok") return openRefusal(opened, device, cwd)
  const data = replyData(opened.response)
  const engineId = openedEngineId(data, isObject(data["state"]) ? data["state"] : {})
  if (engineId === undefined)
    return unsupported(
      device,
      `Device ${device} opened no session for the worktree request.`,
      "Update omo on that device.",
    )
  const located = await remote.sessions.locate(device, engineId, opened.located)
  if (located.kind !== "ok")
    return unsupported(
      device,
      `Device ${device} could not address its worktree session (${located.reason}).`,
      "Update omo on that device.",
    )
  const key = located.sessionId
  const answered = await remote.sessions.sessionCommand(device, key, {
    type: "extension_request",
    sessionId: key,
    name: THREAD_WORKTREE_RPC,
    data: request,
  })
  const result: FarAnswer =
    answered.kind === "ok"
      ? { kind: "answered", data: replyData(answered.response) }
      : answered.kind === "refused" && answered.reason.includes(THREAD_WORKTREE_RPC)
        ? unsupported(
            device,
            `omo on device ${device} cannot create worktrees yet.`,
            "Update omo on that device, then retry.",
          )
        : outcomeFailure(answered, device)
  const closed = await closeLadder(key, async (rpc): Promise<RecordAnswer> => {
    const outcome = await remote.sessions.sessionCommand(device, key, rpc)
    if (outcome.kind === "refused" && SESSION_GONE.has(outcome.reason)) return { kind: "gone", reason: outcome.reason }
    if (outcome.kind !== "ok") throw new ControlRefusal(outcomeFailure(outcome, device).error)
    return { kind: "ok", data: replyData(outcome.response) }
  }).catch((error: unknown) => (error instanceof ControlRefusal ? error.failure.code : String(error)))
  if (result.kind !== "answered" || closed === "closed" || closed === "not_live") return result
  return { ...result, leftOpen: `${key} (${closed})` }
}

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
