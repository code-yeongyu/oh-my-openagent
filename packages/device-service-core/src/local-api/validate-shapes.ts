// Vendored from sisyphuslabs/omo-relay-daemon@dab363aa3a9aa51936149d05b416310d429b61e0 packages/local-api/src/validate-shapes.ts
import { SESSION_DEVICE_MAX_CHARS, SESSION_ID_MAX_CHARS } from "./spec-proto.ts";
import type {
  DeviceRef,
  DeviceRow,
  ErrorBody,
  PathRefusal,
  Policy,
  ReadEntry,
  SnapshotBody,
  Status,
} from "./protocol.ts";
import { SNAPSHOT_OPTIONAL_FIELDS, snapshotFromOf } from "./validate-snapshot-from.ts";
import {
  absolutePath,
  bool,
  entryId,
  exactly,
  fail,
  jsonObject,
  jsonValue,
  LABEL_MAX_CHARS,
  nullable,
  oneOf,
  PATH_MAX_CHARS,
  REASON_MAX_CHARS,
  sha256Field,
  text,
  uint,
} from "./validate-fields.ts";
import {
  ERROR_CODES,
  PATH_REFUSAL_PROBLEMS,
  POLICY_STATES,
  STATUS_STATES,
  THIS_DEVICE_STATES,
} from "./vocabulary.ts";
import { SIGN_IN_REASONS, type StatusDetail } from "./protocol-status.ts";
import { aliasErrorFields } from "./validate-session-answer.ts";
import { statusUpdateOf } from "./validate-update.ts";

// The object shapes shared by requests, responses, events and blob payloads. Field bounds come from the shared
// session-list and command contracts, so a value valid here is valid across the transport.
const CODE = /^[a-z_]{1,64}$/;
const ATTACH_ID_MAX = 4_294_967_295;
const MILLIS_MAX = Number.MAX_SAFE_INTEGER;

export const deviceId = (v: unknown, what = "device"): string =>
  text(v, SESSION_DEVICE_MAX_CHARS, what);
export const sessionId = (v: unknown): string => text(v, SESSION_ID_MAX_CHARS, "session_id");
// omo#13037: a durable engine session id, the wire's session id bound (as session.locate's engine_id).
export const durableId = (v: unknown, what = "durable_id"): string =>
  text(v, SESSION_ID_MAX_CHARS, what);
export const attachId = (v: unknown): number => uint(v, 1, ATTACH_ID_MAX, "attach_id");
export const millis = (v: unknown, what: string): number => uint(v, 0, MILLIS_MAX, what);

export const deviceRef = (v: unknown, what = "device"): DeviceRef => {
  const m = exactly(v, ["id", "name"], [], what);
  return {
    id: deviceId(m["id"], `${what}.id`),
    name: text(m["name"], LABEL_MAX_CHARS, `${what}.name`),
  };
};

const policyOf = (v: unknown): Policy => {
  const m = exactly(
    v,
    ["state", "generation", "this_device", "homes_pending", "unacked"],
    [],
    "policy",
  );
  const unacked = m["unacked"];
  if (!Array.isArray(unacked)) return fail("policy.unacked");
  return {
    state: oneOf(POLICY_STATES, m["state"], "policy.state"),
    generation: millis(m["generation"], "policy.generation"),
    this_device: oneOf(THIS_DEVICE_STATES, m["this_device"], "policy.this_device"),
    homes_pending: millis(m["homes_pending"], "policy.homes_pending"),
    unacked: unacked.map((u) => {
      const entry = exactly(u, ["device", "label"], [], "policy.unacked");
      return {
        device: deviceId(entry["device"]),
        label: text(entry["label"], LABEL_MAX_CHARS, "label", 0),
      };
    }),
  };
};

export const statusOf = (v: unknown): Status => {
  const m = exactly(
    v,
    ["state", "since_ms", "device", "origin_configured", "enabled"],
    ["detail", "policy", "update", "exe"],
    "status",
  );
  const { detail, policy, update, exe } = m;
  return {
    state: oneOf(STATUS_STATES, m["state"], "status.state"),
    since_ms: millis(m["since_ms"], "status.since_ms"),
    ...(detail === undefined ? {} : { detail: detailOf(detail) }),
    device: nullable(m["device"], (d) => deviceRef(d, "status.device")),
    origin_configured: bool(m["origin_configured"], "status.origin_configured"),
    enabled: bool(m["enabled"], "status.enabled"),
    ...(policy === undefined ? {} : { policy: policyOf(policy) }),
    ...(update === undefined ? {} : { update: statusUpdateOf(update) }),
    ...(exe === undefined ? {} : { exe: absolutePath(exe, "status.exe") }),
  };
};

const detailOf = (v: unknown): StatusDetail => {
  const m = exactly(v, ["code", "action"], ["sign_in_reason"], "status.detail");
  const { code, sign_in_reason: reason } = m;
  return {
    code: typeof code === "string" && CODE.test(code) ? code : fail("status.detail.code"),
    action: nullable(m["action"], (a) => text(a, LABEL_MAX_CHARS, "status.detail.action")),
    ...(reason === undefined
      ? {}
      : { sign_in_reason: oneOf(SIGN_IN_REASONS, reason, "status.detail.sign_in_reason") }),
  };
};

export const deviceRowOf = (v: unknown): DeviceRow => {
  const m = exactly(
    v,
    ["device", "label", "kind", "platform", "last_seen_ms", "online"],
    ["managed"],
    "device row",
  );
  const managed = m["managed"];
  return {
    device: deviceId(m["device"]),
    label: text(m["label"], LABEL_MAX_CHARS, "label", 0),
    kind: text(m["kind"], 64, "kind", 0),
    platform: text(m["platform"], 64, "platform", 0),
    last_seen_ms: nullable(m["last_seen_ms"], (t) => millis(t, "last_seen_ms")),
    online: bool(m["online"], "online"),
    ...(managed === undefined ? {} : { managed: bool(managed, "managed") }),
  };
};

const BODY_FIELDS = [
  "attach_id",
  "cursor",
  "state",
  "entries",
  "history_truncated",
  "oldest_entry_id",
];
export const snapshotBodyOf = (m: { readonly [key: string]: unknown }): SnapshotBody => {
  const cursor = exactly(m["cursor"], ["marker_id", "last_entry_id"], [], "cursor");
  const entries = m["entries"];
  if (!Array.isArray(entries)) return fail("entries");
  return {
    attach_id: attachId(m["attach_id"]),
    cursor: {
      marker_id: entryId(cursor["marker_id"], "cursor.marker_id"),
      last_entry_id: nullable(cursor["last_entry_id"], (e) => entryId(e, "cursor.last_entry_id")),
    },
    state: jsonObject(m["state"], "state"),
    entries: entries.map((e) => jsonValue(e, "entries")),
    history_truncated: bool(m["history_truncated"], "history_truncated"),
    oldest_entry_id: nullable(m["oldest_entry_id"], (e) => entryId(e, "oldest_entry_id")),
    ...(m["from"] === undefined ? {} : { from: snapshotFromOf(m["from"]) }),
  };
};
export const snapshotBlobOf = (v: unknown): SnapshotBody =>
  snapshotBodyOf(exactly(v, BODY_FIELDS, SNAPSHOT_OPTIONAL_FIELDS, "snapshot"));
export const SNAPSHOT_FIELDS: readonly string[] = BODY_FIELDS;

export const readEntryOf = (v: unknown): ReadEntry => {
  const m = exactly(v, ["kind", "entry_id"], ["entry", "bytes", "sha256"], "read entry");
  const entry_id = entryId(m["entry_id"], "entry_id");
  if (m["kind"] === "entry") {
    exactly(m, ["kind", "entry_id", "entry"], [], "read entry");
    return { kind: "entry", entry_id, entry: jsonValue(m["entry"], "entry") };
  }
  if (m["kind"] !== "entry_ref") return fail("read entry kind");
  exactly(m, ["kind", "entry_id", "bytes", "sha256"], [], "read entry");
  return {
    kind: "entry_ref",
    entry_id,
    bytes: uint(m["bytes"], 1, MILLIS_MAX, "bytes"),
    sha256: sha256Field(m["sha256"], "sha256"),
  };
};

const pathRefusalOf = (v: unknown): PathRefusal => {
  const m = exactly(v, ["component", "problem"], [], "error.path_refusal");
  return {
    component: text(m["component"], PATH_MAX_CHARS, "error.path_refusal.component"),
    problem: oneOf(PATH_REFUSAL_PROBLEMS, m["problem"], "error.path_refusal.problem"),
  };
};

export const errorBodyOf = (v: unknown): ErrorBody => {
  const m = exactly(
    v,
    ["code", "reason", "action"],
    ["limit_chars", "path_refusal", "candidates", "incomplete", "sign_in_reason"],
    "error",
  );
  const code = oneOf(ERROR_CODES, m["code"], "error.code");
  const reason = m["sign_in_reason"];
  if (reason !== undefined && code !== "sign_in_required") return fail("error.sign_in_reason");
  const limit = m["limit_chars"];
  if ((code === "message_too_long") !== (limit !== undefined)) return fail("error.limit_chars");
  const refusal = m["path_refusal"];
  if (refusal !== undefined && code !== "forbidden") return fail("error.path_refusal");
  return {
    code,
    reason: text(m["reason"], REASON_MAX_CHARS, "error.reason", 0),
    action: nullable(m["action"], (a) => text(a, LABEL_MAX_CHARS, "error.action")),
    ...(limit === undefined
      ? {}
      : { limit_chars: uint(limit, 1, MILLIS_MAX, "error.limit_chars") }),
    ...(refusal === undefined ? {} : { path_refusal: pathRefusalOf(refusal) }),
    ...(reason === undefined
      ? {}
      : { sign_in_reason: oneOf(SIGN_IN_REASONS, reason, "error.sign_in_reason") }),
    ...aliasErrorFields(code, m),
  };
};
