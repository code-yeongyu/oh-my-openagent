import type { ThreadDataError } from "../contracts"
import { closeLadder, SESSION_GONE, type RecordAnswer } from "../control/close-ladder"
import { openedEngineId, openRefusal } from "../control/open-reply"
import { ControlRefusal } from "../control/port"
import { threadToolFailure } from "../errors"
import { notSignedInFailure, outcomeFailure } from "./outcome"
import type { JsonObject, RemoteThreadSurface } from "./ports"
import { replyData } from "./remote-ops"

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const unsupported = (device: string, message: string, next: string): ThreadDataError => ({
  kind: "error",
  error: threadToolFailure("unsupported", message, next, { device }),
})

export type FarAnswer = { readonly kind: "answered"; readonly data: JsonObject; readonly leftOpen?: string } | ThreadDataError

/**
 * One request to another device's omo. The relay carries only engine records, so the device's own omo does the work:
 * a short-lived session opens in `cwd` there, its `extension_request` named `name` runs, and the session is closed
 * again (`leftOpen` names it when it would not close). A device whose omo does not handle `name` answers `unsupported`
 * with `missing`; a folder that is not there answers `folder_missing`.
 */
export async function farExtensionRequest(
  remote: RemoteThreadSurface,
  device: string,
  cwd: string,
  name: string,
  request: JsonObject,
  missing: { readonly message: string; readonly next: string },
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
    return unsupported(device, `Device ${device} opened no session for the ${name} request.`, "Update omo on that device.")
  const located = await remote.sessions.locate(device, engineId, opened.located)
  if (located.kind !== "ok")
    return (
      notSignedInFailure(located.reason, device) ??
      unsupported(
        device,
        `Device ${device} could not address its ${name} session (${located.reason}).`,
        "Update omo on that device.",
      )
    )
  const key = located.sessionId
  const answered = await remote.sessions.sessionCommand(device, key, {
    type: "extension_request",
    sessionId: key,
    name,
    data: request,
  })
  const result: FarAnswer =
    answered.kind === "ok"
      ? { kind: "answered", data: replyData(answered.response) }
      : answered.kind === "refused" && answered.reason.includes(name)
        ? unsupported(device, missing.message, missing.next)
        : outcomeFailure(answered, device)
  const closed = await closeLadder(key, async (rpc): Promise<RecordAnswer> => {
    const outcome = await remote.sessions.sessionCommand(device, key, rpc)
    if (outcome.kind === "refused" && SESSION_GONE.has(outcome.reason)) return { kind: "gone", reason: outcome.reason }
    if (outcome.kind !== "ok") throw new ControlRefusal(outcomeFailure(outcome, device).error)
    return { kind: "ok", data: replyData(outcome.response) }
  }).then(
    (answer) => answer.outcome,
    (error: unknown) => (error instanceof ControlRefusal ? error.failure.code : String(error)),
  )
  if (result.kind !== "answered" || closed === "closed" || closed === "not_live") return result
  return { ...result, leftOpen: `${key} (${closed})` }
}
