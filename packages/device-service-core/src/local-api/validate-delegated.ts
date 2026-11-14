// Vendored from sisyphuslabs/omo-relay-daemon@4ed58920002306a95bf92fe99ca448be89d7103f packages/local-api/src/validate-delegated.ts
import { SESSION_ID_MAX_CHARS } from "./spec-proto.ts";
import { LOCAL_BLOB_MAX, LOCAL_CHUNK_MAX, LOCAL_INLINE_MAX, lineBytes } from "./limits.ts";
import type { EndpointsRegister, EndpointsUnregister } from "./protocol.ts";
import type {
  CommandBlobRef,
  CommandEvent,
  CommandLocated,
  SessionEndpointsData,
} from "./protocol-delegated.ts";
import { isStreamSessionKey } from "./session-ref.ts";
import {
  absolutePath,
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
} from "./validate-fields.ts";
import type { RequestValidators } from "./validate-command.ts";
import { requestFields } from "./validate-command.ts";
import { deviceId } from "./validate-shapes.ts";
import { eventFields, type EventValidators } from "./validate-stream-events.ts";
import { CHANNEL_CLOSED_REASONS } from "./vocabulary.ts";

// Decision 0018 on the local API: the endpoint key a session-less command names, the session.endpoints request and
// answer, and the command channel's events (protocol-delegated.ts).
const ENDPOINT_KEY = /^[A-Za-z0-9_-]{22}$/;
/** A v2 session.list page names at most this many endpoints (relay-spec SESSION_ENDPOINTS_MAX). */
const ENDPOINTS_MAX = 16;
/** Decision 0019: a host registers at most this many environment endpoints (relay-spec SESSION_ENVIRONMENTS_MAX). */
const ENVIRONMENTS_MAX = 4;
export const endpointKey = (v: unknown, what = "endpoint"): string =>
  typeof v === "string" && ENDPOINT_KEY.test(v) ? v : fail(what);

// #393 part B (C6): the durable engine session id a locate carries, the wire's session_id bound (0005 engine_id).
const engineId = (v: unknown): string =>
  typeof v === "string" && v.length >= 1 && v.length <= SESSION_ID_MAX_CHARS && v.isWellFormed()
    ? v
    : fail("engine_id");
export const DELEGATED_REQUEST_VALIDATORS: RequestValidators<
  "session.endpoints" | "session.locate"
> = {
  "session.endpoints": (v, id) => {
    const m = requestFields(v, ["device"], ["primary", "environments"]);
    if (m["primary"] !== undefined && m["primary"] !== true) return fail("primary");
    if (m["environments"] !== undefined && m["environments"] !== true) return fail("environments");
    return {
      id,
      type: "session.endpoints",
      device: deviceId(m["device"]),
      ...(m["primary"] === true ? { primary: true } : {}),
      ...(m["environments"] === true ? { environments: true } : {}),
    };
  },
  "session.locate": (v, id) => {
    const m = requestFields(v, ["device", "engine_id"], ["single"]);
    if (m["single"] !== undefined && m["single"] !== true) return fail("single");
    return {
      id,
      type: "session.locate",
      device: deviceId(m["device"]),
      engine_id: engineId(m["engine_id"]),
      ...(m["single"] === true ? { single: true } : {}),
    };
  },
};
const keysOf = (v: unknown, max: number, what: string): readonly string[] => {
  if (!Array.isArray(v) || v.length > max) return fail(what);
  const keys = v.map((e) => endpointKey(e, what));
  return new Set(keys).size === keys.length ? keys : fail(what);
};
export const endpointsData = (v: unknown): SessionEndpointsData => {
  const m = known(v, ["endpoints"], ["environments", "primary"], "data");
  const endpoints = keysOf(m["endpoints"], ENDPOINTS_MAX, "endpoints");
  const primary = m["primary"] === undefined ? undefined : endpointKey(m["primary"], "primary");
  if (primary !== undefined && !endpoints.includes(primary)) return fail("primary");
  return {
    endpoints,
    ...(m["environments"] === undefined
      ? {}
      : { environments: keysOf(m["environments"], ENVIRONMENTS_MAX, "environments") }),
    ...(primary === undefined ? {} : { primary }),
  };
};
const agentDirOf = (v: Fields): string =>
  absolutePath(requestFields(v, ["agent_dir"])["agent_dir"], "agent_dir");
const environmentOf = (v: Fields, required: readonly string[]): Fields => {
  const m = requestFields(v, required);
  return m["kind"] === "environment" ? m : fail("kind");
};
/** endpoints.register: today's `agent_dir`, or decision 0019's `{kind: "environment", socket, key_root}`. */
export const endpointsRegister = (v: Fields, id: string): EndpointsRegister => {
  if (v["kind"] === undefined) return { id, type: "endpoints.register", agent_dir: agentDirOf(v) };
  const m = environmentOf(v, ["kind", "socket", "key_root"]);
  return {
    id,
    type: "endpoints.register",
    kind: "environment",
    socket: absolutePath(m["socket"], "socket"),
    key_root: absolutePath(m["key_root"], "key_root"),
  };
};
/** endpoints.unregister: today's `agent_dir`, or decision 0019's `{kind: "environment", socket}`. */
export const endpointsUnregister = (v: Fields, id: string): EndpointsUnregister => {
  if (v["kind"] === undefined)
    return { id, type: "endpoints.unregister", agent_dir: agentDirOf(v) };
  const m = environmentOf(v, ["kind", "socket"]);
  return {
    id,
    type: "endpoints.unregister",
    kind: "environment",
    socket: absolutePath(m["socket"], "socket"),
  };
};

type DelegatedKind =
  | "session.command_event"
  | "session.command_blob_chunk"
  | "session.command_blob_done"
  | "session.channel_closed";
const blobId = (m: Fields): string => localId(m["id"], "blob id");
const blobRefOf = (v: unknown): CommandBlobRef => {
  const m = known(v, ["id", "bytes", "sha256"], [], "blob");
  return {
    id: blobId(m),
    bytes: uint(m["bytes"], 1, LOCAL_BLOB_MAX, "blob bytes"),
    sha256: sha256Field(m["sha256"], "blob sha256"),
  };
};
// 0018 amendment 2026-11-06 (5B): {key, session}, the same pair session.locate answers for the event's own device, so
// the session is `<device>.<key>` of that device and never another's (#1129).
const locatedOf = (device: string, v: unknown): CommandLocated => {
  const m = known(v, ["key", "session"], [], "located");
  const key = m["key"];
  if (typeof key !== "string" || !isStreamSessionKey(key)) return fail("located key");
  return m["session"] === `${device}.${key}`
    ? { key, session: `${device}.${key}` }
    : fail("located session");
};
// The three shapes of a command event are told apart by which of their fields is present, so a field one shape defines
// stays refused on another: only a field none of them defines is dropped.
const COMMAND_EVENT_FIELDS = ["blob", "frame", "command_id", "response", "located"];
const commandEventOf = (v: Fields): CommandEvent => {
  const head = { type: "event", kind: "session.command_event" } as const;
  const all = eventFields(v, ["device"], COMMAND_EVENT_FIELDS);
  const shape = (names: readonly string[], optional: readonly string[] = []): Fields =>
    exactly(all, ["type", "kind", "device", ...names], optional, "event");
  if (Object.hasOwn(all, "blob")) {
    const m = shape(["blob"]);
    return { ...head, device: deviceId(m["device"]), blob: blobRefOf(m["blob"]) };
  }
  if (lineBytes(v) > LOCAL_INLINE_MAX)
    return fail("an inline command event over LOCAL_INLINE_MAX is a blob");
  if (Object.hasOwn(all, "frame")) {
    const m = shape(["frame"]);
    return { ...head, device: deviceId(m["device"]), frame: jsonObject(m["frame"], "frame") };
  }
  const m = shape(["command_id", "response"], ["located"]);
  const device = deviceId(m["device"]);
  return {
    ...head,
    device,
    command_id: commandId(m["command_id"]),
    response: jsonObject(m["response"], "response"),
    ...(m["located"] === undefined ? {} : { located: locatedOf(device, m["located"]) }),
  };
};

export const DELEGATED_EVENT_VALIDATORS: EventValidators<DelegatedKind> = {
  "session.command_event": commandEventOf,
  "session.command_blob_chunk": (v) => {
    const m = eventFields(v, ["id", "off", "b"]);
    base64Bytes(m["b"], LOCAL_CHUNK_MAX, "blob chunk");
    return {
      type: "event",
      kind: "session.command_blob_chunk",
      id: blobId(m),
      off: uint(m["off"], 0, LOCAL_BLOB_MAX, "blob off"),
      b: typeof m["b"] === "string" ? m["b"] : fail("blob chunk"),
    };
  },
  "session.command_blob_done": (v) => ({
    type: "event",
    kind: "session.command_blob_done",
    id: blobId(eventFields(v, ["id"])),
  }),
  "session.channel_closed": (v) => {
    const m = eventFields(v, ["device", "reason"]);
    return {
      type: "event",
      kind: "session.channel_closed",
      device: deviceId(m["device"]),
      reason: oneOf(CHANNEL_CLOSED_REASONS, m["reason"], "channel closed reason"),
    };
  },
};
