import type { DeliveriesResponseData, PendingPair } from "./protocol-deliveries.ts"
import { requestFields, type RequestValidators } from "./validate-command.ts"
import { absolutePath, bool, commandId, exactly, fail, type Fields, jsonObject, known, localId, uint } from "./validate-fields.ts"
import { deviceId, durableId } from "./validate-shapes.ts"
import { eventFields, type EventValidators } from "./validate-stream-events.ts"

// omo#13037 on the local API (protocol-deliveries.ts), the same rules as omo-relay-daemon #1076's
// validate-deliveries.ts. The protocol version is any non-negative integer here: the service decides which versions it
// serves, so a newer client's declaration reaches it and is refused by name.
const PROTOCOL_MAX = 1_000_000
// A consumer's pending list is bounded like any one request line; past this many pairs it is malformed.
const PAIRS_MAX = 4096
const pairOf = (m: Fields): PendingPair => ({
  sender_device: deviceId(m["sender_device"], "sender_device"),
  session_id: durableId(m["session_id"], "session_id"),
  last_command_id: commandId(m["last_command_id"]),
})
const PAIR_FIELDS = ["sender_device", "session_id", "last_command_id"]

type DeliveriesRequestType = keyof DeliveriesResponseData

export const DELIVERIES_REQUEST_VALIDATORS: RequestValidators<DeliveriesRequestType> = {
  "delivery.pending": (v, id) => {
    const pairs = requestFields(v, ["pairs"])["pairs"]
    if (!Array.isArray(pairs) || pairs.length > PAIRS_MAX) return fail("pairs")
    return { id, type: "delivery.pending", pairs: pairs.map((p) => pairOf(exactly(p, PAIR_FIELDS, [], "pair"))) }
  },
  "delivery.drained": (v, id) => ({ id, type: "delivery.drained", ...pairOf(requestFields(v, PAIR_FIELDS)) }),
  "deliveries.serve": (v, id) => {
    const m = requestFields(v, ["agent_dir", "v"])
    return {
      id,
      type: "deliveries.serve",
      agent_dir: absolutePath(m["agent_dir"], "agent_dir"),
      v: uint(m["v"], 0, PROTOCOL_MAX, "v"),
    }
  },
  "delivery.answer": (v, id) => {
    const m = requestFields(v, ["sender_device", "command_id", "reply"])
    return {
      id,
      type: "delivery.answer",
      sender_device: deviceId(m["sender_device"], "sender_device"),
      command_id: commandId(m["command_id"]),
      reply: jsonObject(m["reply"], "reply"),
    }
  },
  "delivery.held": (v, id) => {
    const m = requestFields(v, ["ask_id", "holds"])
    return { id, type: "delivery.held", ask_id: localId(m["ask_id"], "ask_id"), holds: bool(m["holds"], "holds") }
  },
  "peer.admitted": (v, id) => ({ id, type: "peer.admitted", device: deviceId(requestFields(v, ["device"])["device"]) }),
}

// The answers are read as every answer this client reads (LA21): a field this version does not define is dropped.
const empty = (v: unknown) => {
  known(v, [], [], "data")
  return {}
}
export const DELIVERIES_DATA: { readonly [T in DeliveriesRequestType]: (v: unknown) => DeliveriesResponseData[T] } = {
  "deliveries.serve": (v) => ({ wake: bool(known(v, ["wake"], [], "data")["wake"], "wake") }),
  "delivery.answer": empty,
  "delivery.held": empty,
  "delivery.pending": empty,
  "delivery.drained": (v) => {
    const m = known(v, ["kept"], ["expecting"], "data")
    const kept = bool(m["kept"], "kept")
    if (!kept) return m["expecting"] === undefined ? { kept } : fail("expecting")
    return { kept, expecting: commandId(m["expecting"]) }
  },
  "peer.admitted": (v) => ({ admitted: bool(known(v, ["admitted"], [], "data")["admitted"], "admitted") }),
}

export const DELIVERIES_EVENT_VALIDATORS: EventValidators<"delivery.inbound" | "delivery.holds" | "delivery.wake"> = {
  "delivery.wake": (v) => ({ type: "event", kind: "delivery.wake", enabled: bool(eventFields(v, ["enabled"])["enabled"], "enabled") }),
  "delivery.inbound": (v) => {
    const m = eventFields(v, ["command_id", "sender_device", "durable_id", "record"])
    return {
      type: "event",
      kind: "delivery.inbound",
      command_id: commandId(m["command_id"]),
      sender_device: deviceId(m["sender_device"], "sender_device"),
      durable_id: durableId(m["durable_id"]),
      record: jsonObject(m["record"], "record"),
    }
  },
  "delivery.holds": (v) => {
    const m = eventFields(v, ["ask_id", "durable_id"])
    return {
      type: "event",
      kind: "delivery.holds",
      ask_id: localId(m["ask_id"], "ask_id"),
      durable_id: durableId(m["durable_id"]),
    }
  },
}
