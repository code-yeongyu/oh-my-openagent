import { LOCAL_BLOB_MAX, LOCAL_CHUNK_MAX, LOCAL_INLINE_MAX, lineBytes } from "./limits.ts"
import type {
  CommandBlobRef,
  CommandEvent,
  CommandLocated,
  SessionCandidate,
  SessionEndpointsData,
} from "./protocol-delegated.ts"
import {
  base64Bytes,
  commandId,
  exactly,
  fail,
  type Fields,
  jsonObject,
  known,
  localId,
  oneOf,
  sha256Field,
  uint,
} from "./validate-fields.ts"
import type { RequestValidators } from "./validate-command.ts"
import { requestFields } from "./validate-command.ts"
import { deviceId } from "./validate-shapes.ts"
import { eventFields, type EventValidators } from "./validate-stream-events.ts"
import { CHANNEL_CLOSED_REASONS } from "./vocabulary.ts"

// Decision 0018 on the local API: the endpoint key a session-less command names, the session.endpoints request and
// answer, and the command channel's events (protocol-delegated.ts).
const ENDPOINT_KEY = /^[A-Za-z0-9_-]{22}$/
/** A v2 session.list page names at most this many endpoints (the relay host's session-endpoint bound). */
const ENDPOINTS_MAX = 16
export const endpointKey = (v: unknown, what = "endpoint"): string =>
  typeof v === "string" && ENDPOINT_KEY.test(v) ? v : fail(what)

// #393 part B: the durable engine session id a locate carries (1-128 characters, docs/local-api.md session.locate).
const ENGINE_ID_MAX_CHARS = 128
const engineId = (v: unknown): string =>
  typeof v === "string" && v.length >= 1 && v.length <= ENGINE_ID_MAX_CHARS && v.isWellFormed() ? v : fail("engine_id")
export const DELEGATED_REQUEST_VALIDATORS: RequestValidators<"session.endpoints" | "session.locate"> = {
  "session.endpoints": (v, id) => ({
    id,
    type: "session.endpoints",
    device: deviceId(requestFields(v, ["device"])["device"]),
  }),
  "session.locate": (v, id) => {
    const m = requestFields(v, ["device", "engine_id"])
    return { id, type: "session.locate", device: deviceId(m["device"]), engine_id: engineId(m["engine_id"]) }
  },
}
/** session.locate's answer: the device, the stream key the device's listing names the session by, and `<device>.<key>`. */
export const locateData = (v: unknown): SessionCandidate => {
  const m = known(v, ["device", "key", "session"], [], "data")
  const device = deviceId(m["device"])
  const key = endpointKey(m["key"], "key")
  return m["session"] === `${device}.${key}` ? { device, key, session: `${device}.${key}` } : fail("session")
}
export const endpointsData = (v: unknown): SessionEndpointsData => {
  const endpoints = known(v, ["endpoints"], [], "data")["endpoints"]
  if (!Array.isArray(endpoints) || endpoints.length > ENDPOINTS_MAX) return fail("endpoints")
  const keys = endpoints.map((e) => endpointKey(e, "endpoints"))
  return new Set(keys).size === keys.length ? { endpoints: keys } : fail("endpoints")
}

type DelegatedKind =
  "session.command_event" | "session.command_blob_chunk" | "session.command_blob_done" | "session.channel_closed"
const blobId = (m: Fields): string => localId(m["id"], "blob id")
const blobRefOf = (v: unknown): CommandBlobRef => {
  const m = known(v, ["id", "bytes", "sha256"], [], "blob")
  return {
    id: blobId(m),
    bytes: uint(m["bytes"], 1, LOCAL_BLOB_MAX, "blob bytes"),
    sha256: sha256Field(m["sha256"], "blob sha256"),
  }
}
// Decision 0018 amendment 2026-11-06: {key, session}, the same pair session.locate answers for the event's device.
const locatedOf = (device: string, v: unknown): CommandLocated => {
  const m = known(v, ["key", "session"], [], "located")
  const key = endpointKey(m["key"], "located key")
  return m["session"] === `${device}.${key}` ? { key, session: `${device}.${key}` } : fail("located session")
}
// The three shapes of a command event are told apart by which of their fields is present, so a field one shape defines
// stays refused on another: only a field none of them defines is dropped.
const COMMAND_EVENT_FIELDS = ["blob", "frame", "command_id", "response", "located"]
const commandEventOf = (v: Fields): CommandEvent => {
  const head = { type: "event", kind: "session.command_event" } as const
  const all = eventFields(v, ["device"], COMMAND_EVENT_FIELDS)
  const shape = (names: readonly string[], optional: readonly string[] = []): Fields =>
    exactly(all, ["type", "kind", "device", ...names], optional, "event")
  if (Object.hasOwn(all, "blob")) {
    const m = shape(["blob"])
    return { ...head, device: deviceId(m["device"]), blob: blobRefOf(m["blob"]) }
  }
  if (lineBytes(v) > LOCAL_INLINE_MAX) return fail("an inline command event over LOCAL_INLINE_MAX is a blob")
  if (Object.hasOwn(all, "frame")) {
    const m = shape(["frame"])
    return { ...head, device: deviceId(m["device"]), frame: jsonObject(m["frame"], "frame") }
  }
  const m = shape(["command_id", "response"], ["located"])
  const device = deviceId(m["device"])
  return {
    ...head,
    device,
    command_id: commandId(m["command_id"]),
    response: jsonObject(m["response"], "response"),
    ...(m["located"] === undefined ? {} : { located: locatedOf(device, m["located"]) }),
  }
}

export const DELEGATED_EVENT_VALIDATORS: EventValidators<DelegatedKind> = {
  "session.command_event": commandEventOf,
  "session.command_blob_chunk": (v) => {
    const m = eventFields(v, ["id", "off", "b"])
    base64Bytes(m["b"], LOCAL_CHUNK_MAX, "blob chunk")
    return {
      type: "event",
      kind: "session.command_blob_chunk",
      id: blobId(m),
      off: uint(m["off"], 0, LOCAL_BLOB_MAX, "blob off"),
      b: typeof m["b"] === "string" ? m["b"] : fail("blob chunk"),
    }
  },
  "session.command_blob_done": (v) => ({
    type: "event",
    kind: "session.command_blob_done",
    id: blobId(eventFields(v, ["id"])),
  }),
  "session.channel_closed": (v) => {
    const m = eventFields(v, ["device", "reason"])
    return {
      type: "event",
      kind: "session.channel_closed",
      device: deviceId(m["device"]),
      reason: oneOf(CHANNEL_CLOSED_REASONS, m["reason"], "channel closed reason"),
    }
  },
}
