import type { ThreadDataError } from "../contracts"
import { closeLadder, SESSION_GONE, type RecordAnswer } from "../control/close-ladder"
import { openedEngineId, openRefusal } from "../control/open-reply"
import { ControlRefusal } from "../control/port"
import { isThreadErrorCode, threadToolFailure } from "../errors"
import { outcomeFailure } from "../remote/outcome"
import type { JsonObject, RemoteThreadSurface } from "../remote/ports"
import { replyData } from "../remote/remote-ops"
import type { ThreadWorktree, WorktreeOutcome, WorktreeRequest } from "./thread-worktree"
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
  return unsupported(device, `Device ${device} answered the worktree request with an unexpected reply.`, "Update omo on that device.")
}

/**
 * Creates a thread's worktree on another device. The relay carries only engine records, so the device's own omo does
 * the work: a short-lived session opens in the repository folder there, its `extension_request`
 * (`omo.thread.worktree`, `worktree-rpc.ts`) creates the worktree, and the session is closed again. A device whose omo
 * predates the request answers `unsupported` naming the update; a folder that is not there answers `folder_missing`.
 */
export async function prepareRemoteWorktree(
  remote: RemoteThreadSurface,
  device: string,
  cwd: string,
  request: WorktreeRequest,
): Promise<WorktreeOutcome> {
  const opened = await remote.sessions.endpointCommand(
    device,
    { type: "open_session", retain_on_disconnect: true, cwd },
    { locate: true },
  )
  if (opened.kind !== "ok") return openRefusal(opened, device, cwd)
  const data = replyData(opened.response)
  const engineId = openedEngineId(data, isObject(data["state"]) ? data["state"] : {})
  if (engineId === undefined)
    return unsupported(device, `Device ${device} opened no session for the worktree request.`, "Update omo on that device.")
  const located = await remote.sessions.locate(device, engineId, opened.located)
  if (located.kind !== "ok")
    return unsupported(device, `Device ${device} could not address its worktree session (${located.reason}).`, "Update omo on that device.")
  const key = located.sessionId
  const answered = await remote.sessions.sessionCommand(device, key, {
    type: "extension_request",
    sessionId: key,
    name: THREAD_WORKTREE_RPC,
    data: { cwd, ...request },
  })
  const result: WorktreeOutcome =
    answered.kind === "ok"
      ? farOutcome(replyData(answered.response), device)
      : answered.kind === "refused" && answered.reason.includes(THREAD_WORKTREE_RPC)
        ? unsupported(device, `omo on device ${device} cannot create worktrees yet.`, "Update omo on that device, then retry.")
        : outcomeFailure(answered, device)
  const closed = await closeLadder(key, async (rpc): Promise<RecordAnswer> => {
    const outcome = await remote.sessions.sessionCommand(device, key, rpc)
    if (outcome.kind === "refused" && SESSION_GONE.has(outcome.reason)) return { kind: "gone", reason: outcome.reason }
    if (outcome.kind !== "ok") throw new ControlRefusal(outcomeFailure(outcome, device).error)
    return { kind: "ok", data: replyData(outcome.response) }
  }).catch((error: unknown) => (error instanceof ControlRefusal ? error.failure.code : String(error)))
  if (result.kind !== "ok" || closed === "closed" || closed === "not_live") return result
  return { kind: "ok", worktree: { ...result.worktree, setup_session_left_open: `${key} (${closed})` } }
}
