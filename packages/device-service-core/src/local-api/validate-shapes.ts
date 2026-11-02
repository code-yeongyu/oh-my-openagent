import {
  SESSION_DEVICE_MAX_CHARS,
  SESSION_ID_MAX_CHARS,
  SESSION_SUMMARY_PATH_MAX_CHARS,
  SESSION_SUMMARY_PROJECT_MAX_CHARS,
  SESSION_SUMMARY_TITLE_MAX_CHARS,
} from "./spec-proto.ts";
import type {
  DeviceRef,
  DeviceRow,
  ErrorBody,
  ListingRow,
  Policy,
  ReadEntry,
  SnapshotBody,
  Status,
} from "./protocol.ts";
import {
  bool,
  entryId,
  exactly,
  fail,
  jsonObject,
  jsonValue,
  LABEL_MAX_CHARS,
  nullable,
  oneOf,
  REASON_MAX_CHARS,
  sha256Field,
  text,
  uint,
} from "./validate-fields.ts";
import {
  ERROR_CODES,
  LISTING_SOURCES,
  POLICY_STATES,
  SESSION_ROW_STATES,
  STATUS_STATES,
  THIS_DEVICE_STATES,
} from "./vocabulary.ts";

// The object shapes shared by requests, responses, events and blob payloads. Field bounds come from the shared
// session-list and command contracts, so a value valid here is valid across the transport.
const CODE = /^[a-z_]{1,64}$/;
const ATTACH_ID_MAX = 4_294_967_295;
const MILLIS_MAX = Number.MAX_SAFE_INTEGER;

export const deviceId = (v: unknown, what = "device"): string =>
  text(v, SESSION_DEVICE_MAX_CHARS, what);
export const sessionId = (v: unknown): string => text(v, SESSION_ID_MAX_CHARS, "session_id");
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
    ["detail", "policy"],
    "status",
  );
  const detail = m["detail"];
  const policy = m["policy"];
  return {
    state: oneOf(STATUS_STATES, m["state"], "status.state"),
    since_ms: millis(m["since_ms"], "status.since_ms"),
    ...(detail === undefined ? {} : { detail: detailOf(detail) }),
    device: nullable(m["device"], (d) => deviceRef(d, "status.device")),
    origin_configured: bool(m["origin_configured"], "status.origin_configured"),
    enabled: bool(m["enabled"], "status.enabled"),
    ...(policy === undefined ? {} : { policy: policyOf(policy) }),
  };
};

const detailOf = (v: unknown): { readonly code: string; readonly action: string | null } => {
  const m = exactly(v, ["code", "action"], [], "status.detail");
  const code = m["code"];
  return {
    code: typeof code === "string" && CODE.test(code) ? code : fail("status.detail.code"),
    action: nullable(m["action"], (a) => text(a, LABEL_MAX_CHARS, "status.detail.action")),
  };
};

export const deviceRowOf = (v: unknown): DeviceRow => {
  const m = exactly(
    v,
    ["device", "label", "kind", "platform", "last_seen_ms", "online"],
    [],
    "device row",
  );
  return {
    device: deviceId(m["device"]),
    label: text(m["label"], LABEL_MAX_CHARS, "label", 0),
    kind: text(m["kind"], 64, "kind", 0),
    platform: text(m["platform"], 64, "platform", 0),
    last_seen_ms: nullable(m["last_seen_ms"], (t) => millis(t, "last_seen_ms")),
    online: bool(m["online"], "online"),
  };
};

const ROW_FIELDS = [
  "device",
  "session_id",
  "title",
  "project",
  "path",
  "state",
  "updated_ms",
  "source",
  "as_of",
];
export const listingRowOf = (v: unknown): ListingRow => {
  const m = exactly(v, ROW_FIELDS, [], "listing row");
  return {
    device: deviceId(m["device"]),
    session_id: sessionId(m["session_id"]),
    title: text(m["title"], SESSION_SUMMARY_TITLE_MAX_CHARS, "title", 0),
    project: text(m["project"], SESSION_SUMMARY_PROJECT_MAX_CHARS, "project"),
    path: text(m["path"], SESSION_SUMMARY_PATH_MAX_CHARS, "path"),
    state: oneOf(SESSION_ROW_STATES, m["state"], "row state"),
    updated_ms: millis(m["updated_ms"], "updated_ms"),
    source: oneOf(LISTING_SOURCES, m["source"], "row source"),
    as_of: millis(m["as_of"], "as_of"),
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
  };
};
export const snapshotBlobOf = (v: unknown): SnapshotBody =>
  snapshotBodyOf(exactly(v, BODY_FIELDS, [], "snapshot"));
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

export const errorBodyOf = (v: unknown): ErrorBody => {
  const m = exactly(v, ["code", "reason", "action"], ["limit_chars"], "error");
  const code = oneOf(ERROR_CODES, m["code"], "error.code");
  const limit = m["limit_chars"];
  if ((code === "message_too_long") !== (limit !== undefined)) return fail("error.limit_chars");
  return {
    code,
    reason: text(m["reason"], REASON_MAX_CHARS, "error.reason", 0),
    action: nullable(m["action"], (a) => text(a, LABEL_MAX_CHARS, "error.action")),
    ...(limit === undefined
      ? {}
      : { limit_chars: uint(limit, 1, MILLIS_MAX, "error.limit_chars") }),
  };
};
