import { LocalApiError } from "./errors.ts";
import type {
  Empty,
  ErrorBody,
  Hello,
  LocalEvent,
  LocalRequest,
  Refused,
  RefusedReason,
  RequestType,
  ResponseData,
  SnapshotBody,
  Welcome,
} from "./protocol.ts";
import { LOCAL_UPLOAD_PARTS_MAX } from "./upload.ts";
import { EVENT_KINDS, validateEventFields } from "./validate-events.ts";
import {
  absolutePath,
  bool,
  commandId,
  exactly,
  fail,
  InvalidMessage,
  isRecord,
  localId,
  nonce,
  nullable,
  oneOf,
  requestId,
  semver,
  uint,
} from "./validate-fields.ts";
import { isRequestType, REQUEST_TYPES, validateRequestFields } from "./validate-requests.ts";
import {
  deviceRef,
  deviceRowOf,
  errorBodyOf,
  snapshotBlobOf,
  statusOf,
} from "./validate-shapes.ts";
import { CAPABILITIES, CLIENT_NAMES, LOCAL_API_VERSION, REFUSED_REASONS } from "./vocabulary.ts";

export { EVENT_KINDS, isRequestType, REQUEST_TYPES };

const asViolation = <T>(check: () => T): T => {
  try {
    return check();
  } catch (error) {
    if (error instanceof InvalidMessage)
      throw new LocalApiError("protocol_violation", error.detail);
    throw error;
  }
};

// The version is read before the shape, so a hello or welcome from a newer peer is refused "version", never
// "malformed", whatever fields that version added.
export type HelloVerdict =
  | { readonly ok: true; readonly hello: Hello }
  | { readonly ok: false; readonly reason: RefusedReason };
export const validateHello = (v: unknown): HelloVerdict => {
  if (!isRecord(v) || v["type"] !== "hello") return { ok: false, reason: "malformed" };
  if (v["v"] !== LOCAL_API_VERSION)
    return { ok: false, reason: typeof v["v"] === "number" ? "version" : "malformed" };
  try {
    const m = exactly(v, ["type", "v", "client", "client_nonce"], [], "hello");
    const c = exactly(m["client"], ["name", "version"], ["data_home"], "client");
    const name = oneOf(CLIENT_NAMES, c["name"], "client.name");
    const dataHome = c["data_home"];
    if (name === "desktop" && dataHome === undefined)
      return { ok: false, reason: "data_home_required" };
    if (name !== "desktop" && dataHome !== undefined)
      return fail("data_home is for desktop clients");
    const client = {
      name,
      version: semver(c["version"], "client.version"),
      ...(dataHome === undefined ? {} : { data_home: absolutePath(dataHome, "client.data_home") }),
    };
    return {
      ok: true,
      hello: {
        type: "hello",
        v: LOCAL_API_VERSION,
        client,
        client_nonce: nonce(m["client_nonce"], "client_nonce"),
      },
    };
  } catch (error) {
    if (error instanceof InvalidMessage) return { ok: false, reason: "malformed" };
    throw error;
  }
};

export const validateWelcome = (v: unknown): Welcome | Refused =>
  asViolation(() => {
    if (isRecord(v) && v["type"] === "refused") {
      const m = exactly(v, ["type", "reason"], [], "refused");
      return { type: "refused", reason: oneOf(REFUSED_REASONS, m["reason"], "refused reason") };
    }
    if (isRecord(v) && v["type"] === "welcome" && v["v"] !== LOCAL_API_VERSION)
      return { type: "refused", reason: "version" };
    const fields = [
      "type",
      "v",
      "service_version",
      "owner",
      "server_proof",
      "server_nonce",
      "capabilities",
      "state",
    ];
    const m = exactly(v, fields, [], "welcome");
    const capabilities = m["capabilities"];
    if (m["type"] !== "welcome" || m["owner"] !== "service") return fail("welcome");
    if (!Array.isArray(capabilities) || new Set(capabilities).size !== capabilities.length)
      return fail("capabilities");
    return {
      type: "welcome",
      v: LOCAL_API_VERSION,
      service_version: semver(m["service_version"], "service_version"),
      owner: "service",
      server_proof: nonce(m["server_proof"], "server_proof"),
      server_nonce: nonce(m["server_nonce"], "server_nonce"),
      capabilities: capabilities.map((c) => oneOf(CAPABILITIES, c, "capability")),
      state: statusOf(m["state"]),
    };
  });

export type RequestVerdict =
  | { readonly ok: true; readonly request: LocalRequest }
  | {
      readonly ok: false;
      readonly id: string | null;
      readonly code: "invalid_request" | "unknown_type";
      readonly reason: string;
    };
export const validateRequest = (v: unknown): RequestVerdict => {
  if (!isRecord(v))
    return { ok: false, id: null, code: "invalid_request", reason: "a request is an object" };
  const id = requestId(v["id"]);
  if (id === undefined)
    return { ok: false, id: null, code: "invalid_request", reason: "a request carries an id" };
  const type = v["type"];
  if (!isRequestType(type))
    return { ok: false, id, code: "unknown_type", reason: "this version defines no such request" };
  try {
    return { ok: true, request: validateRequestFields(type, v, id) };
  } catch (error) {
    if (error instanceof InvalidMessage)
      return { ok: false, id, code: "invalid_request", reason: error.detail };
    throw error;
  }
};

const empty = (v: unknown): Empty => {
  exactly(v, [], [], "data");
  return {};
};
const one = (v: unknown, name: string): unknown => exactly(v, [name], [], "data")[name];
const DATA: { readonly [T in RequestType]: (v: unknown) => ResponseData[T] } = {
  authenticate: empty,
  "status.get": statusOf,
  "status.subscribe": empty,
  "service.set_enabled": (v) => ({ enabled: bool(one(v, "enabled"), "enabled") }),
  "refresher.register": empty,
  "device.adopt": (v) => ({ device: deviceRef(one(v, "device")) }),
  "device.forget": empty,
  "device.info": (v) => ({ device: nullable(one(v, "device"), (d) => deviceRef(d)) }),
  "endpoints.register": empty,
  "endpoints.unregister": empty,
  "devices.list": (v) => {
    const devices = one(v, "devices");
    return Array.isArray(devices) ? { devices: devices.map(deviceRowOf) } : fail("devices");
  },
  "sessions.list": (v) => ({ query_id: localId(one(v, "query_id"), "query_id") }),
  "session.attach": (v) => ({ attach: localId(one(v, "attach"), "attach") }),
  "session.detach": empty,
  "session.command": (v) => ({ command_id: commandId(one(v, "command_id")) }),
  "session.command_part": (v) => ({
    received: uint(one(v, "received"), 0, LOCAL_UPLOAD_PARTS_MAX - 1, "received"),
  }),
  "session.read": (v) => ({ query_id: localId(one(v, "query_id"), "query_id") }),
  "enforcement.report": empty,
  "owner.shutdown_for_upgrade": empty,
};

export type ValidResponse<T extends RequestType> =
  | { readonly id: string; readonly ok: true; readonly data: ResponseData[T] }
  | { readonly id: string; readonly ok: false; readonly error: ErrorBody };
export const validateResponse = <T extends RequestType>(v: unknown, type: T): ValidResponse<T> =>
  asViolation(() => {
    const m = exactly(v, ["id", "type", "ok"], ["data", "error"], "response");
    const id = requestId(m["id"]) ?? fail("response id");
    if (m["type"] !== "response") return fail("response type");
    if (m["ok"] === true) {
      exactly(m, ["id", "type", "ok", "data"], [], "response");
      return { id, ok: true, data: DATA[type](m["data"]) };
    }
    if (m["ok"] !== false) return fail("response ok");
    exactly(m, ["id", "type", "ok", "error"], [], "response");
    return { id, ok: false, error: errorBodyOf(m["error"]) };
  });

export const validateEvent = (v: unknown): LocalEvent =>
  asViolation(() => (isRecord(v) ? validateEventFields(v) : fail("an event is an object")));

export const validateSnapshotBlob = (v: unknown): SnapshotBody =>
  asViolation(() => snapshotBlobOf(v));
