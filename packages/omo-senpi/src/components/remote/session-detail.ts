import type { JsonObject } from "../thread/remote/ports"
import type { DeviceRow, SessionDetail, SessionRow, ThreadHandle } from "./types"

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)

/**
 * One session's detail from the engine's `get_state` reply, on its listing row when its device lists it; a session the
 * listing does not carry (yet) gets a row from that same state (its name, folder and whether a turn runs).
 */
export function sessionDetail(
  thread: ThreadHandle,
  device: DeviceRow,
  listed: SessionRow | undefined,
  data: JsonObject,
): SessionDetail {
  const model = isObject(data["model"]) ? data["model"] : {}
  const provider = text(model["provider"])
  const id = text(model["id"])
  const turn = text(data["currentTurnId"])
  const queued = data["pendingMessageCount"]
  const name = text(data["sessionName"]) ?? ""
  const durable = text(data["sessionId"])
  const row: SessionRow = listed ?? {
    thread,
    ...(durable === undefined ? {} : { durable_id: durable }),
    name,
    title: name,
    device,
    project: text(data["cwd"]) ?? "",
    path: text(data["sessionFile"]) ?? "",
    state: data["isStreaming"] === true ? "running" : "idle",
    archived: false,
    // No listing row says when it last changed.
    updated_ms: 0,
    source: "live",
  }
  return {
    ...row,
    cwd: text(data["cwd"]) ?? row.path,
    model: provider === undefined || id === undefined ? "" : `${provider}/${id}`,
    reasoning: text(data["thinkingLevel"]) ?? "",
    preset: text(data["permissionPreset"]) ?? "",
    ...(turn === undefined ? {} : { turn: { id: turn, state: data["isStreaming"] === true ? "running" : "idle" } }),
    pending: {
      dialogs: Array.isArray(data["pendingDialogs"]) ? data["pendingDialogs"].length : 0,
      queued: typeof queued === "number" ? queued : 0,
    },
  }
}
