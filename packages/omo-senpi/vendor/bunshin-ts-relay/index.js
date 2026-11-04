/*!
# License

OmO Device Service End-User License Agreement
SPDX-License-Identifier: LicenseRef-OmO-Device-Service-EULA

This repository and every artifact built from it (the OmO device service, also called the
relay daemon, in source or binary form) are proprietary work:

1. **Proprietary work**: all code, documentation, and other material in this repository,
   Copyright (c) 2026 Yeongyu Kim, proprietary — all rights reserved (see the End-User
   License below).
2. All third party components incorporated into this software are licensed under the original
   license provided by the owner of the applicable component.
3. The public `omo-ai` package is not covered by this agreement. It remains under its own
   Sustainable Use License and only downloads the closed artifact described here; nothing in
   this agreement changes that package's license.

## End-User License (proprietary)

Copyright (c) 2026 Yeongyu Kim. All rights reserved.

You may install and run the binary artifact of this software only as delivered to you by an
official OmO installer or downloaded from get.omo.dev, and only together with OmO.

Redistribution is permitted only inside official OmO installers and through get.omo.dev.
No other license is granted. Without the prior written permission of the copyright holder you
may not:

1. copy, publish, distribute, sublicense, sell, or otherwise redistribute the software or any
   artifact built from it separately from an official OmO installer or get.omo.dev;
2. modify, merge, adapt, translate, or create derivative works of the software; or
3. reverse engineer, decompile, disassemble, or otherwise attempt to derive the source code,
   protocols, or keys of the software, except to the extent applicable law expressly permits
   it notwithstanding this limitation.

Access to the source code, where granted, is provided solely for preparing contributions to
the Project (the omo-device-service software and its binaries distributed by Yeongyu Kim).
Contributions are governed by the Contributor License Agreement (CLA.md).

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED. IN NO EVENT
SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY ARISING FROM
THE SOFTWARE OR ITS USE.
*/

// packages/local-api/src/vocabulary.ts
var LOCAL_API_VERSION = 1;
var STATUS_STATES = [
  "not_configured",
  "disabled",
  "sign_in_required",
  "plan_required",
  "keychain_locked",
  "connecting",
  "activation_pending",
  "connected",
  "offline",
  "authorization_stale",
  "service_degraded",
  "update_required",
  "signed_out"
];
var POLICY_STATES = ["off", "pending", "active"];
var THIS_DEVICE_STATES = [
  "unclassified",
  "desktop_unregistered",
  "indeterminate",
  "desktop",
  "cli_only",
  "acked"
];
var CAPABILITIES = ["sessions", "devices", "enforcement", "upgrade", "control"];
var OPTIONAL_CAPABILITIES = ["machine"];
var REFUSED_REASONS = ["version", "data_home_required", "malformed"];
var ROUND_STATES = ["open", "done"];
var ROUND_DEVICE_STATES = [
  "answered",
  "pending",
  "undelivered",
  "page_cap",
  "cursor_echo",
  "timed_out",
  "skipped"
];
var LISTING_SOURCES = ["live", "cache"];
var SESSION_ROW_STATES = ["running", "idle", "ended"];
var FILTER_KEYS = ["device", "project", "state"];
var BLOB_OF = ["state", "record", "entry"];
var BLOB_ABORT_REASONS = [
  "digest_mismatch",
  "source_gone",
  "too_large",
  "detached"
];
var UPLOAD_ABORT_REASONS = [
  "message_too_long",
  "parts_conflict",
  "malformed",
  "detached"
];
var DETACH_REASONS = [
  "authorization_expired",
  "activation_pending",
  "service_disabled",
  "owner_transfer",
  "peer_revoked",
  "stream_key_pending",
  "peer_detached",
  "blob_failed",
  "session_closed",
  "session_replaced"
];
var ATTACH_PENDING_REASONS = ["stream_key_pending"];
var COMMAND_ID_CHARS = 22;
var COMMAND_STATES = [
  "queued",
  "transport_confirmed",
  "not confirmed",
  "not delivered: never_sent",
  "engine_dispatched",
  "engine_applied",
  "engine_refused",
  "engine_stale",
  "uncertain"
];
var COMMAND_UNCERTAIN_REASONS = [
  "request_gone",
  "no_receipt",
  "engine_restarted",
  "recipient_revoked",
  "transport_expired",
  "unconfirmed",
  "lease_expired",
  "cancelled",
  "hand_restarted",
  "result_expired",
  "record_too_large",
  "result_undecodable"
];
var COMMAND_REFUSAL_REASONS = [
  "parts_conflict",
  "peer_unauthorized",
  "message_too_long",
  "engine_capability_missing",
  "malformed",
  "method_unclassified",
  "method_local_only",
  "capability_missing",
  "schema_stale",
  "tool_unknown",
  "cancelled",
  "hand_restarted",
  "scope_unknown",
  "scope_closed",
  "epoch_fenced",
  "epoch_step_exceeded",
  "route_unlisted"
];
var RETRYABLE_STATES = [
  "not confirmed",
  "not delivered: never_sent"
];
var MACHINE_OP_STATES = [
  "queued",
  "transport_confirmed",
  "host_dispatched",
  "host_applied",
  "link_down"
];
var MACHINE_STATES = ["online", "offline", "unsupported"];
var MACHINE_LOOKUP_STATES = ["in_flight", "terminal", "unknown"];
var MACHINE_BLOB_ABORT_REASONS = ["digest_mismatch", "source_gone", "too_large"];
var CHANNEL_CLOSED_REASONS = [
  "event_overflow",
  "event_too_large",
  "idle",
  "engine_closed",
  "event_lost",
  "event_gap"
];
// packages/local-api/src/event-gate.ts
var GATED = new Set(["session_closed", "session_replaced"]);
// packages/local-api/src/errors.ts
class LocalApiError extends Error {
  code;
  reason;
  action;
  limit_chars;
  path_refusal;
  command_id;
  candidates;
  incomplete;
  constructor(code, reason, extra = {}) {
    super(`${code}: ${reason}`);
    this.name = "LocalApiError";
    this.code = code;
    this.reason = reason;
    this.action = extra.action ?? null;
    if (extra.limit_chars !== undefined)
      this.limit_chars = extra.limit_chars;
    if (extra.path_refusal !== undefined)
      this.path_refusal = extra.path_refusal;
    if (extra.command_id !== undefined)
      this.command_id = extra.command_id;
    if (extra.candidates !== undefined)
      this.candidates = extra.candidates;
    if (extra.incomplete !== undefined)
      this.incomplete = extra.incomplete;
  }
}
// packages/local-api/src/framing.ts
var LOCAL_LINE_MAX = 1048576;
var LF = 10;
var encoder = new TextEncoder;
var utf8 = new TextDecoder("utf-8", { fatal: true });
var encodeLine = (value) => {
  const body = encoder.encode(JSON.stringify(value));
  if (body.length > LOCAL_LINE_MAX)
    throw new LocalApiError("protocol_violation", `a ${body.length}-byte line exceeds LOCAL_LINE_MAX`);
  const line = new Uint8Array(body.length + 1);
  line.set(body);
  line[body.length] = LF;
  return line;
};
var parseLine = (line) => {
  let decoded;
  try {
    decoded = utf8.decode(line);
  } catch (error) {
    if (error instanceof TypeError)
      throw new LocalApiError("protocol_violation", "a line is not UTF-8");
    throw error;
  }
  try {
    return JSON.parse(decoded);
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new LocalApiError("protocol_violation", "a line is not JSON");
    throw error;
  }
};

class LineDecoder {
  #onLine;
  #onOversized;
  #parts = [];
  #length = 0;
  #discarding = false;
  constructor(onLine, onOversized) {
    this.#onLine = onLine;
    this.#onOversized = onOversized;
  }
  push(chunk) {
    let start = 0;
    while (start < chunk.length) {
      const lf = chunk.indexOf(LF, start);
      this.#take(chunk.subarray(start, lf === -1 ? chunk.length : lf));
      if (lf === -1)
        return;
      this.#finish();
      start = lf + 1;
    }
  }
  #take(piece) {
    if (this.#discarding || piece.length === 0)
      return;
    if (this.#length + piece.length > LOCAL_LINE_MAX) {
      this.#discarding = true;
      this.#onOversized(this.#length + piece.length);
      this.#parts = [];
      this.#length = 0;
      return;
    }
    this.#parts.push(piece.slice());
    this.#length += piece.length;
  }
  #finish() {
    if (this.#discarding) {
      this.#discarding = false;
      return;
    }
    const line = new Uint8Array(this.#length);
    let at = 0;
    for (const part of this.#parts) {
      line.set(part, at);
      at += part.length;
    }
    this.#parts = [];
    this.#length = 0;
    this.#onLine(line);
  }
}
// packages/local-api/src/limits.ts
import { createHash } from "node:crypto";

// packages/bunshin-ts-relay/src/spec-proto.ts
var SESSION_BLOB_MAX = 16777216;
var SESSION_DEVICE_MAX_CHARS = 64;
var SESSION_PROJECT_MAX_CHARS = 256;
var SESSION_ID_MAX_CHARS = 128;
var SESSION_READ_TAIL_MAX = 200;
var SESSION_SUMMARY_TITLE_MAX_CHARS = 256;
var SESSION_SUMMARY_PROJECT_MAX_CHARS = 128;
var SESSION_SUMMARY_PATH_MAX_CHARS = 1024;
var SESSION_KIND_MAX_CHARS = 32;
var STREAM_INLINE_MAX = 12000;
var METHOD = /^(?=.{1,64}$)[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
var UNSAFE_KEYS = ["__proto__", "constructor", "prototype"];

class ProtoError extends Error {
  code;
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.code = code;
    this.name = "ProtoError";
  }
}
var fail = (detail) => {
  throw new ProtoError("bad_request", `session payload ${detail}`);
};
var STREAM_KEY = /^[A-Za-z0-9_-]{22}$/;
var validateStreamSessionKey = (v) => typeof v === "string" && STREAM_KEY.test(v) ? v : fail("session key");
var validRosterDeviceId = (value) => typeof value === "string" && value.length > 0 && value.length <= 64 && value.isWellFormed();
var methodOf = (v, what) => {
  const type = typeof v === "string" && METHOD.test(v) ? v : fail(what);
  for (const segment of type.split("."))
    if (UNSAFE_KEYS.includes(segment))
      fail(what);
  return type;
};

// packages/local-api/src/limits.ts
var LOCAL_INLINE_MAX = 524288;
var LOCAL_CHUNK_MAX = 262144;
var LOCAL_JSON_EXPANSION_MAX = 6;
var LOCAL_BLOB_MAX = LOCAL_JSON_EXPANSION_MAX * SESSION_BLOB_MAX;
var encoder2 = new TextEncoder;
var lineBytes = (value) => encoder2.encode(JSON.stringify(value)).length + 1;
var sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
var chunkPayload = (data) => {
  const chunks = [];
  for (let off = 0;off < data.length; off += LOCAL_CHUNK_MAX)
    chunks.push({
      off,
      b: Buffer.from(data.subarray(off, off + LOCAL_CHUNK_MAX)).toString("base64")
    });
  return chunks;
};

// packages/local-api/src/validate-fields.ts
import { posix, win32 } from "node:path";
var LOCAL_ID_MAX_CHARS = 64;
var PATH_MAX_CHARS = 4096;
var LABEL_MAX_CHARS = 256;
var ENTRY_ID_MAX_BYTES = 128;
var NONCE_CHARS = 43;

class InvalidMessage extends Error {
  detail;
  constructor(detail) {
    super(detail);
    this.name = "InvalidMessage";
    this.detail = detail;
  }
}
var fail2 = (detail) => {
  throw new InvalidMessage(detail);
};
var keysOf = (record) => Object.keys(record).filter((key) => Object.hasOwn(record, key));
var isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var exactly = (v, required, optional = [], what = "message") => {
  if (!isRecord(v))
    return fail2(`${what} must be an object`);
  for (const name of required)
    if (!Object.hasOwn(v, name))
      fail2(`${what} misses ${name}`);
  for (const key of Object.keys(v))
    if (!required.includes(key) && !optional.includes(key))
      fail2(`${what} has an unknown field`);
  return v;
};
var oneOf = (list, v, what) => list.find((item) => item === v) ?? fail2(what);
var text = (v, max, what, min = 1) => typeof v === "string" && v.length >= min && v.length <= max && v.isWellFormed() ? v : fail2(what);
var bool = (v, what) => typeof v === "boolean" ? v : fail2(what);
var uint = (v, min, max, what) => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : fail2(what);
var BASE64URL = /^[A-Za-z0-9_-]+$/;
var localId = (v, what) => typeof v === "string" && v.length >= 1 && v.length <= LOCAL_ID_MAX_CHARS && BASE64URL.test(v) ? v : fail2(what);
var commandId = (v) => typeof v === "string" && v.length === COMMAND_ID_CHARS && BASE64URL.test(v) ? v : fail2("command_id");
var nonce = (v, what) => typeof v === "string" && v.length === NONCE_CHARS && BASE64URL.test(v) ? v : fail2(what);
var SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
var semver = (v, what) => typeof v === "string" && v.length <= 64 && SEMVER.test(v) ? v : fail2(what);
var absolutePath = (v, what) => typeof v === "string" && v.length <= PATH_MAX_CHARS && v.isWellFormed() && !v.includes("\x00") && (posix.isAbsolute(v) || win32.isAbsolute(v)) ? v : fail2(what);
var entryId = (v, what) => typeof v === "string" && v.length > 0 && v.isWellFormed() && new TextEncoder().encode(v).length <= ENTRY_ID_MAX_BYTES ? v : fail2(what);
var nullable = (v, check) => v === null ? null : check(v);
var SHA256_HEX = /^[0-9a-f]{64}$/;
var sha256Field = (v, what) => typeof v === "string" && SHA256_HEX.test(v) ? v : fail2(what);
var base64Bytes = (v, max, what) => {
  if (typeof v !== "string" || v.length === 0 || v.length > 4 * Math.ceil(max / 3))
    return fail2(what);
  const bytes = Buffer.from(v, "base64");
  return bytes.length <= max && bytes.toString("base64") === v ? new Uint8Array(bytes) : fail2(what);
};
var UNSAFE_KEYS2 = ["__proto__", "constructor", "prototype"];
var safeKey = (key, what) => UNSAFE_KEYS2.includes(key) ? fail2(what) : key;
var jsonValue = (v, what) => {
  if (v === null || typeof v === "boolean" || typeof v === "string")
    return v;
  if (typeof v === "number")
    return Number.isFinite(v) ? v : fail2(what);
  if (Array.isArray(v))
    return v.map((item) => jsonValue(item, what));
  if (isRecord(v))
    return jsonObject(v, what);
  return fail2(what);
};
var jsonObject = (v, what) => {
  if (!isRecord(v))
    return fail2(what);
  const out = {};
  for (const [key, item] of Object.entries(v))
    out[key] = jsonValue(item, what);
  return out;
};
// packages/local-api/src/command-text.ts
var COMMAND_TEXT_MAX_BYTES = 3000000;

// packages/local-api/src/upload.ts
var LOCAL_UPLOAD_PARTS_MAX = Math.ceil(COMMAND_TEXT_MAX_BYTES / LOCAL_CHUNK_MAX);
var uploadParts = (value) => {
  const chunks = chunkPayload(new TextEncoder().encode(value));
  return chunks.map(({ b }, index) => ({ index, count: chunks.length, b }));
};
// packages/local-api/src/session-ref.ts
var KEY_CHARS = 22;
var MIN_CHARS = KEY_CHARS + 2;
var MAX_CHARS = KEY_CHARS + 65;
var isStreamSessionKey = (v) => {
  try {
    validateStreamSessionKey(v);
    return true;
  } catch (error) {
    if (error instanceof ProtoError)
      return false;
    throw error;
  }
};
var parseSessionRef = (v) => {
  if (typeof v !== "string" || !v.isWellFormed())
    return;
  if (v.length < MIN_CHARS || v.length > MAX_CHARS || v[v.length - KEY_CHARS - 1] !== ".")
    return;
  const device = v.slice(0, -KEY_CHARS - 1);
  const key = v.slice(-KEY_CHARS);
  return isStreamSessionKey(key) && validRosterDeviceId(device) ? { device, key } : undefined;
};
var formatSessionRef = (ref) => {
  if (!isStreamSessionKey(ref.key) || !validRosterDeviceId(ref.device))
    throw new RangeError("not a session id: the device or the key is malformed");
  return `${ref.device}.${ref.key}`;
};
var CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
var ALIAS_MAX_CHARS = 256;
var unsafeAlias = (s) => s !== s.trim() || CONTROL.test(s) || parseSessionRef(s) !== undefined || isStreamSessionKey(s);
// packages/local-api/src/validate-session-answer.ts
var refOf = (v, what) => {
  const m = exactly(v, ["device", "key", "session"], [], what);
  const ref = parseSessionRef(m["session"]);
  if (ref === undefined || ref.device !== m["device"] || ref.key !== m["key"])
    return fail2(what);
  return { device: ref.device, key: ref.key, session: formatSessionRef(ref) };
};
var commandAnswerOf = (v) => {
  const m = exactly(v, ["command_id"], ["device", "key", "session"], "session.command data");
  const command_id = commandId(m["command_id"]);
  if (m["device"] === undefined && m["key"] === undefined && m["session"] === undefined)
    return { command_id };
  const { device, key, session } = m;
  return { command_id, ...refOf({ device, key, session }, "session.command data") };
};

// packages/local-api/src/validate-shapes.ts
var CODE = /^[a-z_]{1,64}$/;
var ATTACH_ID_MAX = 4294967295;
var MILLIS_MAX = Number.MAX_SAFE_INTEGER;
var deviceId = (v, what = "device") => text(v, SESSION_DEVICE_MAX_CHARS, what);
var sessionId = (v) => text(v, SESSION_ID_MAX_CHARS, "session_id");
var attachId = (v) => uint(v, 1, ATTACH_ID_MAX, "attach_id");
var millis = (v, what) => uint(v, 0, MILLIS_MAX, what);
var deviceRef = (v, what = "device") => {
  const m = exactly(v, ["id", "name"], [], what);
  return {
    id: deviceId(m["id"], `${what}.id`),
    name: text(m["name"], LABEL_MAX_CHARS, `${what}.name`)
  };
};
var policyOf = (v) => {
  const m = exactly(v, ["state", "generation", "this_device", "homes_pending", "unacked"], [], "policy");
  const unacked = m["unacked"];
  if (!Array.isArray(unacked))
    return fail2("policy.unacked");
  return {
    state: oneOf(POLICY_STATES, m["state"], "policy.state"),
    generation: millis(m["generation"], "policy.generation"),
    this_device: oneOf(THIS_DEVICE_STATES, m["this_device"], "policy.this_device"),
    homes_pending: millis(m["homes_pending"], "policy.homes_pending"),
    unacked: unacked.map((u) => {
      const entry = exactly(u, ["device", "label"], [], "policy.unacked");
      return {
        device: deviceId(entry["device"]),
        label: text(entry["label"], LABEL_MAX_CHARS, "label", 0)
      };
    })
  };
};
var statusOf = (v) => {
  const m = exactly(v, ["state", "since_ms", "device", "origin_configured", "enabled"], ["detail", "policy"], "status");
  const detail = m["detail"];
  const policy = m["policy"];
  return {
    state: oneOf(STATUS_STATES, m["state"], "status.state"),
    since_ms: millis(m["since_ms"], "status.since_ms"),
    ...detail === undefined ? {} : { detail: detailOf(detail) },
    device: nullable(m["device"], (d) => deviceRef(d, "status.device")),
    origin_configured: bool(m["origin_configured"], "status.origin_configured"),
    enabled: bool(m["enabled"], "status.enabled"),
    ...policy === undefined ? {} : { policy: policyOf(policy) }
  };
};
var detailOf = (v) => {
  const m = exactly(v, ["code", "action"], [], "status.detail");
  const code = m["code"];
  return {
    code: typeof code === "string" && CODE.test(code) ? code : fail2("status.detail.code"),
    action: nullable(m["action"], (a) => text(a, LABEL_MAX_CHARS, "status.detail.action"))
  };
};
var deviceRowOf = (v) => {
  const m = exactly(v, ["device", "label", "kind", "platform", "last_seen_ms", "online"], [], "device row");
  return {
    device: deviceId(m["device"]),
    label: text(m["label"], LABEL_MAX_CHARS, "label", 0),
    kind: text(m["kind"], 64, "kind", 0),
    platform: text(m["platform"], 64, "platform", 0),
    last_seen_ms: nullable(m["last_seen_ms"], (t) => millis(t, "last_seen_ms")),
    online: bool(m["online"], "online")
  };
};
var ROW_FIELDS = [
  "device",
  "session_id",
  "title",
  "project",
  "path",
  "state",
  "updated_ms",
  "source",
  "as_of"
];
var ROW_KIND = new RegExp(`^[a-z][a-z0-9_-]{0,${SESSION_KIND_MAX_CHARS - 1}}$`);
var rowLinks = (m) => {
  const kind = m["kind"];
  if (Object.hasOwn(m, "parent") !== Object.hasOwn(m, "parent_listed"))
    fail2("parent_listed");
  return {
    ...kind === undefined ? {} : { kind: typeof kind === "string" && ROW_KIND.test(kind) ? kind : fail2("row kind") },
    ...m["parent"] === undefined ? {} : {
      parent: sessionId(m["parent"]),
      parent_listed: bool(m["parent_listed"], "parent_listed")
    }
  };
};
var listingRowOf = (v) => {
  const m = exactly(v, ROW_FIELDS, ["kind", "parent", "parent_listed"], "listing row");
  return {
    ...rowLinks(m),
    device: deviceId(m["device"]),
    session_id: sessionId(m["session_id"]),
    title: text(m["title"], SESSION_SUMMARY_TITLE_MAX_CHARS, "title", 0),
    project: text(m["project"], SESSION_SUMMARY_PROJECT_MAX_CHARS, "project"),
    path: text(m["path"], SESSION_SUMMARY_PATH_MAX_CHARS, "path"),
    state: oneOf(SESSION_ROW_STATES, m["state"], "row state"),
    updated_ms: millis(m["updated_ms"], "updated_ms"),
    source: oneOf(LISTING_SOURCES, m["source"], "row source"),
    as_of: millis(m["as_of"], "as_of")
  };
};
var BODY_FIELDS = [
  "attach_id",
  "cursor",
  "state",
  "entries",
  "history_truncated",
  "oldest_entry_id"
];
var snapshotBodyOf = (m) => {
  const cursor = exactly(m["cursor"], ["marker_id", "last_entry_id"], [], "cursor");
  const entries = m["entries"];
  if (!Array.isArray(entries))
    return fail2("entries");
  return {
    attach_id: attachId(m["attach_id"]),
    cursor: {
      marker_id: entryId(cursor["marker_id"], "cursor.marker_id"),
      last_entry_id: nullable(cursor["last_entry_id"], (e) => entryId(e, "cursor.last_entry_id"))
    },
    state: jsonObject(m["state"], "state"),
    entries: entries.map((e) => jsonValue(e, "entries")),
    history_truncated: bool(m["history_truncated"], "history_truncated"),
    oldest_entry_id: nullable(m["oldest_entry_id"], (e) => entryId(e, "oldest_entry_id"))
  };
};
var SNAPSHOT_FIELDS = BODY_FIELDS;
var readEntryOf = (v) => {
  const m = exactly(v, ["kind", "entry_id"], ["entry", "bytes", "sha256"], "read entry");
  const entry_id = entryId(m["entry_id"], "entry_id");
  if (m["kind"] === "entry") {
    exactly(m, ["kind", "entry_id", "entry"], [], "read entry");
    return { kind: "entry", entry_id, entry: jsonValue(m["entry"], "entry") };
  }
  if (m["kind"] !== "entry_ref")
    return fail2("read entry kind");
  exactly(m, ["kind", "entry_id", "bytes", "sha256"], [], "read entry");
  return {
    kind: "entry_ref",
    entry_id,
    bytes: uint(m["bytes"], 1, MILLIS_MAX, "bytes"),
    sha256: sha256Field(m["sha256"], "sha256")
  };
};

// packages/local-api/src/validate-stream-events.ts
var eventFields = (v, names, optional = []) => exactly(v, ["type", "kind", ...names], optional, "event");
var attachOf = (m) => localId(m["attach"], "attach");
var queryOf = (m) => localId(m["query_id"], "query_id");
var blobIdOf = (m) => localId(m["id"], "blob id");
var targetOf = (m) => {
  const of = oneOf(BLOB_OF, m["of"], "blob of");
  switch (of) {
    case "state": {
      const p = exactly(m["position"], ["attach_id"], [], "position");
      return { of, position: { attach_id: attachId(p["attach_id"]) } };
    }
    case "record": {
      const p = exactly(m["position"], ["attach_id", "seq"], [], "position");
      const seq = uint(p["seq"], 1, Number.MAX_SAFE_INTEGER, "seq");
      return { of, position: { attach_id: attachId(p["attach_id"]), seq } };
    }
    case "entry": {
      const p = exactly(m["position"], ["query_id", "entry_id"], [], "position");
      return {
        of,
        position: { query_id: queryOf(p), entry_id: entryId(p["entry_id"], "position.entry_id") }
      };
    }
  }
};
var STREAM_EVENT_VALIDATORS = {
  "session.snapshot": (v) => {
    const m = eventFields(v, ["attach", ...SNAPSHOT_FIELDS]);
    return { type: "event", kind: "session.snapshot", attach: attachOf(m), ...snapshotBodyOf(m) };
  },
  "session.snapshot_loading": (v) => {
    const m = eventFields(v, ["attach", "blob"]);
    return {
      type: "event",
      kind: "session.snapshot_loading",
      attach: attachOf(m),
      blob: localId(m["blob"], "blob")
    };
  },
  "session.records": (v) => {
    const m = eventFields(v, ["attach", "attach_id", "records"]);
    const records = m["records"];
    if (!Array.isArray(records) || records.length === 0)
      return fail2("records");
    const attach_id = attachId(m["attach_id"]);
    return {
      type: "event",
      kind: "session.records",
      attach: attachOf(m),
      attach_id,
      records: records.map((r) => jsonObject(r, "record"))
    };
  },
  "session.blob_open": (v) => {
    const m = eventFields(v, ["attach", "id", "of", "bytes", "sha256", "position"]);
    return {
      type: "event",
      kind: "session.blob_open",
      attach: attachOf(m),
      id: blobIdOf(m),
      bytes: uint(m["bytes"], 1, LOCAL_BLOB_MAX, "blob bytes"),
      sha256: sha256Field(m["sha256"], "blob sha256"),
      ...targetOf(m)
    };
  },
  "session.blob_chunk": (v) => {
    const m = eventFields(v, ["attach", "id", "off", "b"]);
    base64Bytes(m["b"], LOCAL_CHUNK_MAX, "blob chunk");
    const b = typeof m["b"] === "string" ? m["b"] : fail2("blob chunk");
    const off = uint(m["off"], 0, LOCAL_BLOB_MAX, "blob off");
    return {
      type: "event",
      kind: "session.blob_chunk",
      attach: attachOf(m),
      id: blobIdOf(m),
      off,
      b
    };
  },
  "session.blob_done": (v) => {
    const m = eventFields(v, ["attach", "id"]);
    return { type: "event", kind: "session.blob_done", attach: attachOf(m), id: blobIdOf(m) };
  },
  "session.blob_abort": (v) => {
    const head = eventFields(v, ["attach", "id", "reason"], ["query_id", "entry_id"]);
    const reason = oneOf(BLOB_ABORT_REASONS, head["reason"], "blob abort reason");
    const base = {
      type: "event",
      kind: "session.blob_abort",
      attach: attachOf(head),
      id: blobIdOf(head)
    };
    if (reason !== "too_large") {
      eventFields(v, ["attach", "id", "reason"]);
      return { ...base, reason };
    }
    const m = eventFields(v, ["attach", "id", "reason", "query_id", "entry_id"]);
    return { ...base, reason, query_id: queryOf(m), entry_id: entryId(m["entry_id"], "entry_id") };
  },
  "session.attach_pending": (v) => {
    const m = eventFields(v, ["attach", "reason"]);
    const reason = oneOf(ATTACH_PENDING_REASONS, m["reason"], "pending reason");
    return { type: "event", kind: "session.attach_pending", attach: attachOf(m), reason };
  },
  "session.detached": (v) => {
    const m = eventFields(v, ["attach", "reason"]);
    const reason = oneOf(DETACH_REASONS, m["reason"], "detach reason");
    return { type: "event", kind: "session.detached", attach: attachOf(m), reason };
  }
};

// packages/local-api/src/validate-delegated.ts
var ENDPOINT_KEY = /^[A-Za-z0-9_-]{22}$/;
var ENDPOINTS_MAX = 16;
var ENVIRONMENTS_MAX = 4;
var endpointKey = (v, what = "endpoint") => typeof v === "string" && ENDPOINT_KEY.test(v) ? v : fail2(what);
var engineId = (v) => typeof v === "string" && v.length >= 1 && v.length <= SESSION_ID_MAX_CHARS && v.isWellFormed() ? v : fail2("engine_id");
var DELEGATED_REQUEST_VALIDATORS = {
  "session.endpoints": (v, id) => ({
    id,
    type: "session.endpoints",
    device: deviceId(requestFields(v, ["device"])["device"])
  }),
  "session.locate": (v, id) => {
    const m = requestFields(v, ["device", "engine_id"]);
    return {
      id,
      type: "session.locate",
      device: deviceId(m["device"]),
      engine_id: engineId(m["engine_id"])
    };
  }
};
var keysOf2 = (v, max, what) => {
  if (!Array.isArray(v) || v.length > max)
    return fail2(what);
  const keys = v.map((e) => endpointKey(e, what));
  return new Set(keys).size === keys.length ? keys : fail2(what);
};
var endpointsData = (v) => {
  const m = exactly(v, ["endpoints"], ["environments"], "data");
  const endpoints = keysOf2(m["endpoints"], ENDPOINTS_MAX, "endpoints");
  if (m["environments"] === undefined)
    return { endpoints };
  return { endpoints, environments: keysOf2(m["environments"], ENVIRONMENTS_MAX, "environments") };
};
var agentDirOf = (v) => absolutePath(requestFields(v, ["agent_dir"])["agent_dir"], "agent_dir");
var environmentOf = (v, required) => {
  const m = requestFields(v, required);
  return m["kind"] === "environment" ? m : fail2("kind");
};
var endpointsRegister = (v, id) => {
  if (v["kind"] === undefined)
    return { id, type: "endpoints.register", agent_dir: agentDirOf(v) };
  const m = environmentOf(v, ["kind", "socket", "key_root"]);
  return {
    id,
    type: "endpoints.register",
    kind: "environment",
    socket: absolutePath(m["socket"], "socket"),
    key_root: absolutePath(m["key_root"], "key_root")
  };
};
var endpointsUnregister = (v, id) => {
  if (v["kind"] === undefined)
    return { id, type: "endpoints.unregister", agent_dir: agentDirOf(v) };
  const m = environmentOf(v, ["kind", "socket"]);
  return {
    id,
    type: "endpoints.unregister",
    kind: "environment",
    socket: absolutePath(m["socket"], "socket")
  };
};
var blobId = (m) => localId(m["id"], "blob id");
var blobRefOf = (v) => {
  const m = exactly(v, ["id", "bytes", "sha256"], [], "blob");
  return {
    id: blobId(m),
    bytes: uint(m["bytes"], 1, LOCAL_BLOB_MAX, "blob bytes"),
    sha256: sha256Field(m["sha256"], "blob sha256")
  };
};
var commandEventOf = (v) => {
  const head = { type: "event", kind: "session.command_event" };
  if (Object.hasOwn(v, "blob")) {
    const m = eventFields(v, ["device", "blob"]);
    return { ...head, device: deviceId(m["device"]), blob: blobRefOf(m["blob"]) };
  }
  if (lineBytes(v) > LOCAL_INLINE_MAX)
    return fail2("an inline command event over LOCAL_INLINE_MAX is a blob");
  if (Object.hasOwn(v, "frame")) {
    const m = eventFields(v, ["device", "frame"]);
    return { ...head, device: deviceId(m["device"]), frame: jsonObject(m["frame"], "frame") };
  }
  const m = eventFields(v, ["device", "command_id", "response"]);
  return {
    ...head,
    device: deviceId(m["device"]),
    command_id: commandId(m["command_id"]),
    response: jsonObject(m["response"], "response")
  };
};
var DELEGATED_EVENT_VALIDATORS = {
  "session.command_event": commandEventOf,
  "session.command_blob_chunk": (v) => {
    const m = eventFields(v, ["id", "off", "b"]);
    base64Bytes(m["b"], LOCAL_CHUNK_MAX, "blob chunk");
    return {
      type: "event",
      kind: "session.command_blob_chunk",
      id: blobId(m),
      off: uint(m["off"], 0, LOCAL_BLOB_MAX, "blob off"),
      b: typeof m["b"] === "string" ? m["b"] : fail2("blob chunk")
    };
  },
  "session.command_blob_done": (v) => ({
    type: "event",
    kind: "session.command_blob_done",
    id: blobId(eventFields(v, ["id"]))
  }),
  "session.channel_closed": (v) => {
    const m = eventFields(v, ["device", "reason"]);
    return {
      type: "event",
      kind: "session.channel_closed",
      device: deviceId(m["device"]),
      reason: oneOf(CHANNEL_CLOSED_REASONS, m["reason"], "channel closed reason")
    };
  }
};

// packages/local-api/src/validate-command.ts
var commandRpcOf = (v) => jsonObject(v, "rpc");
var requestFields = (v, names, optional = []) => exactly(v, ["id", "type", ...names], optional, "request");
var commandIdField = (v) => v === undefined ? {} : { command_id: commandId(v) };
var ROUTE_FIELDS = ["command_id", "delegated", "endpoint"];
var routeFields = (m) => {
  const delegated = m["delegated"];
  if (delegated !== undefined && delegated !== true)
    return fail2("delegated");
  return {
    ...delegated === true ? { delegated: true } : {},
    ...m["endpoint"] === undefined ? {} : { endpoint: endpointKey(m["endpoint"]) }
  };
};
var TARGETS = ["attach", "device", "session", "alias"];
var targetField = (v) => {
  const named = TARGETS.filter((f) => Object.hasOwn(v, f));
  const [only] = named;
  return named.length === 1 && only !== undefined ? only : fail2("request names one target");
};
var TARGET_FIELDS = {
  attach: ["attach"],
  device: ["device", "endpoint"],
  session: ["session"],
  alias: ["alias"]
};
var sessionField = (v) => typeof v === "string" && parseSessionRef(v) !== undefined ? v : fail2("session");
var aliasField = (v) => typeof v === "string" && v.length >= 1 && v.length <= ALIAS_MAX_CHARS && v.isWellFormed() && !unsafeAlias(v) ? v : fail2("alias");
var oneField = (m, field) => {
  switch (field) {
    case "attach":
      return { attach: localId(m["attach"], "attach") };
    case "session":
      return { session: sessionField(m["session"]) };
    case "alias":
      return { alias: aliasField(m["alias"]) };
  }
};
var targetOf2 = (m, field) => field === "device" ? { device: deviceId(m["device"]), endpoint: endpointKey(m["endpoint"]) } : oneField(m, field);
var partTargetOf = (m, field) => field === "device" ? { device: deviceId(m["device"]) } : oneField(m, field);
var COMMAND_REQUEST_VALIDATORS = {
  "session.command": (v, id) => {
    const field = targetField(v);
    const target = TARGET_FIELDS[field];
    const body = Object.hasOwn(v, "upload_id") ? "upload_id" : "rpc";
    const delegated = field === "session" || field === "alias";
    const optional = delegated ? ["command_id"] : ROUTE_FIELDS.filter((f) => !target.includes(f));
    const m = requestFields(v, [...target, body], optional);
    return {
      id,
      type: "session.command",
      ...commandIdField(m["command_id"]),
      ...body === "upload_id" ? { upload_id: localId(m["upload_id"], "upload_id") } : { rpc: commandRpcOf(m["rpc"]) },
      ...routeFields(m),
      ...targetOf2(m, field)
    };
  },
  "session.command_part": (v, id) => {
    const target = targetField(v);
    const m = requestFields(v, [target, "upload_id", "index", "count", "b"]);
    const count = uint(m["count"], 1, LOCAL_UPLOAD_PARTS_MAX, "count");
    base64Bytes(m["b"], LOCAL_CHUNK_MAX, "b");
    return {
      id,
      type: "session.command_part",
      ...partTargetOf(m, target),
      upload_id: localId(m["upload_id"], "upload_id"),
      index: uint(m["index"], 0, count - 1, "index"),
      count,
      b: typeof m["b"] === "string" ? m["b"] : fail2("b")
    };
  }
};

// packages/local-api/src/validate-machine.ts
var MACHINE_OPS_MAX = 4096;
var MACHINE_REF_MAX_CHARS = 128;
var MACHINE_CREDIT_MAX_BYTES = SESSION_BLOB_MAX;
var BASE64URL2 = /^[A-Za-z0-9_-]+$/;
var machineId = (v, what) => typeof v === "string" && v.length === COMMAND_ID_CHARS && BASE64URL2.test(v) ? v : fail2(what);
var machineRef = (v, what) => text(v, MACHINE_REF_MAX_CHARS, what);
var opName = (v) => {
  try {
    return methodOf(v, "op");
  } catch (error) {
    if (error instanceof ProtoError)
      return fail2("op");
    throw error;
  }
};
var opOf = (v) => {
  const m = exactly(v, ["op_id", "op", "args"], ["deadline_ms", "constraints"], "op");
  const deadline = m["deadline_ms"];
  const constraints = m["constraints"];
  return {
    op_id: machineId(m["op_id"], "op_id"),
    op: opName(m["op"]),
    args: jsonObject(m["args"], "args"),
    ...deadline === undefined ? {} : { deadline_ms: uint(deadline, 1, Number.MAX_SAFE_INTEGER, "deadline_ms") },
    ...constraints === undefined ? {} : { constraints: jsonObject(constraints, "constraints") }
  };
};
var uniqueIds = (ids, what) => new Set(ids).size === ids.length ? ids : fail2(`duplicate ${what}`);
var machineOpsOf = (v) => {
  if (!Array.isArray(v) || v.length === 0 || v.length > MACHINE_OPS_MAX)
    return fail2("ops");
  const ops = v.map(opOf);
  uniqueIds(ops.map((o) => o.op_id), "op_id");
  return ops;
};
var refOf2 = (m) => m["session_ref"] === undefined ? {} : { session_ref: machineRef(m["session_ref"], "session_ref") };
var bare = (v) => {
  requestFields(v, []);
};
var MACHINE_REQUEST_VALIDATORS = {
  "machine.list": (v, id) => {
    bare(v);
    return { id, type: "machine.list" };
  },
  "machine.events.subscribe": (v, id) => {
    bare(v);
    return { id, type: "machine.events.subscribe" };
  },
  "machine.describe": (v, id) => ({
    id,
    type: "machine.describe",
    device: deviceId(requestFields(v, ["device"])["device"])
  }),
  "machine.batch": (v, id) => {
    if (Object.hasOwn(v, "upload_id")) {
      const m = requestFields(v, ["device", "upload_id"], ["session_ref"]);
      const upload_id = localId(m["upload_id"], "upload_id");
      return { id, type: "machine.batch", device: deviceId(m["device"]), upload_id, ...refOf2(m) };
    }
    const m = requestFields(v, ["device", "ops"], ["session_ref"]);
    if (lineBytes(v) > LOCAL_INLINE_MAX)
      return fail2("an inline batch over LOCAL_INLINE_MAX is an upload");
    return {
      id,
      type: "machine.batch",
      device: deviceId(m["device"]),
      ops: machineOpsOf(m["ops"]),
      ...refOf2(m)
    };
  },
  "machine.batch_part": (v, id) => {
    const m = requestFields(v, ["upload_id", "index", "count", "b"]);
    const count = uint(m["count"], 1, LOCAL_UPLOAD_PARTS_MAX, "count");
    base64Bytes(m["b"], LOCAL_CHUNK_MAX, "b");
    return {
      id,
      type: "machine.batch_part",
      upload_id: localId(m["upload_id"], "upload_id"),
      index: uint(m["index"], 0, count - 1, "index"),
      count,
      b: typeof m["b"] === "string" ? m["b"] : fail2("b")
    };
  },
  "machine.cancel": (v, id) => {
    const ids = requestFields(v, ["op_ids"])["op_ids"];
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MACHINE_OPS_MAX)
      return fail2("op_ids");
    const op_ids = uniqueIds(ids.map((o) => machineId(o, "op_id")), "op_id");
    return { id, type: "machine.cancel", op_ids };
  },
  "machine.credit": (v, id) => {
    const m = requestFields(v, ["handle", "bytes"]);
    return {
      id,
      type: "machine.credit",
      handle: machineRef(m["handle"], "handle"),
      bytes: uint(m["bytes"], 1, MACHINE_CREDIT_MAX_BYTES, "bytes")
    };
  },
  "machine.result_of": (v, id) => ({
    id,
    type: "machine.result_of",
    op_id: machineId(requestFields(v, ["op_id"])["op_id"], "op_id")
  })
};
var empty = (v) => {
  exactly(v, [], [], "data");
  return {};
};
var fields = (v, names) => exactly(v, names, [], "data");
var machineRowOf = (v) => {
  const m = exactly(v, ["device", "label", "state"], [], "machine row");
  return {
    device: deviceId(m["device"]),
    label: text(m["label"], LABEL_MAX_CHARS, "label", 0),
    state: oneOf(MACHINE_STATES, m["state"], "machine state")
  };
};
var MACHINE_DATA = {
  "machine.list": (v) => {
    const machines = fields(v, ["machines"])["machines"];
    return Array.isArray(machines) ? { machines: machines.map(machineRowOf) } : fail2("machines");
  },
  "machine.describe": (v) => {
    const m = fields(v, ["device", "description"]);
    if (!isRecord(m["description"]))
      return fail2("description");
    return {
      device: deviceId(m["device"]),
      description: jsonObject(m["description"], "description")
    };
  },
  "machine.batch": (v) => ({
    batch_id: machineId(fields(v, ["batch_id"])["batch_id"], "batch_id")
  }),
  "machine.batch_part": (v) => ({
    received: uint(fields(v, ["received"])["received"], 0, LOCAL_UPLOAD_PARTS_MAX - 1, "received")
  }),
  "machine.cancel": empty,
  "machine.credit": empty,
  "machine.result_of": (v) => ({
    state: oneOf(MACHINE_LOOKUP_STATES, fields(v, ["state"])["state"], "lookup state")
  }),
  "machine.events.subscribe": empty
};

// packages/local-api/src/validate-machine-events.ts
var MACHINE_OUTPUT_MAX_BYTES = STREAM_INLINE_MAX;
var blobId2 = (m) => localId(m["id"], "blob id");
var blobRefOf2 = (v) => {
  const m = exactly(v, ["id", "bytes", "sha256"], [], "blob");
  return {
    id: blobId2(m),
    bytes: uint(m["bytes"], 1, LOCAL_BLOB_MAX, "blob bytes"),
    sha256: sha256Field(m["sha256"], "blob sha256")
  };
};
var base64Of = (v, max, what) => {
  base64Bytes(v, max, what);
  return typeof v === "string" ? v : fail2(what);
};
var TIMING_FIELDS = [
  "enqueued_ms",
  "flushed_ms",
  "confirmed_ms",
  "dispatched_ms",
  "settled_ms",
  "applied_ms"
];
var timingOf = (v) => {
  const m = exactly(v, [], TIMING_FIELDS, "timing");
  return Object.fromEntries(TIMING_FIELDS.flatMap((k) => m[k] === undefined ? [] : [[k, uint(m[k], 0, Number.MAX_SAFE_INTEGER, k)]]));
};
var opResultOf = (v) => {
  const head = { type: "event", kind: "machine.op_result" };
  if (Object.hasOwn(v, "blob")) {
    const m = eventFields(v, ["op_id", "blob"]);
    return { ...head, op_id: machineId(m["op_id"], "op_id"), blob: blobRefOf2(m["blob"]) };
  }
  const m = eventFields(v, ["op_id", "response"]);
  if (lineBytes(v) > LOCAL_INLINE_MAX)
    return fail2("an inline result over LOCAL_INLINE_MAX is a blob");
  return {
    ...head,
    op_id: machineId(m["op_id"], "op_id"),
    response: jsonObject(m["response"], "response")
  };
};
var MACHINE_EVENT_VALIDATORS = {
  "machine.op_state": (v) => {
    const m = eventFields(v, ["op_id", "state"], ["timing"]);
    return {
      type: "event",
      kind: "machine.op_state",
      op_id: machineId(m["op_id"], "op_id"),
      state: oneOf(MACHINE_OP_STATES, m["state"], "op state"),
      ...m["timing"] === undefined ? {} : { timing: timingOf(m["timing"]) }
    };
  },
  "machine.op_result": opResultOf,
  "machine.output": (v) => {
    const m = eventFields(v, ["handle", "seq", "bytes"]);
    return {
      type: "event",
      kind: "machine.output",
      handle: machineRef(m["handle"], "handle"),
      seq: uint(m["seq"], 0, Number.MAX_SAFE_INTEGER, "seq"),
      bytes: base64Of(m["bytes"], MACHINE_OUTPUT_MAX_BYTES, "bytes")
    };
  },
  "machine.changed": (v) => {
    const m = eventFields(v, ["device", "state"]);
    return {
      type: "event",
      kind: "machine.changed",
      device: deviceId(m["device"]),
      state: oneOf(MACHINE_STATES, m["state"], "machine state")
    };
  },
  "machine.blob_chunk": (v) => {
    const m = eventFields(v, ["id", "off", "b"]);
    return {
      type: "event",
      kind: "machine.blob_chunk",
      id: blobId2(m),
      off: uint(m["off"], 0, LOCAL_BLOB_MAX, "blob off"),
      b: base64Of(m["b"], LOCAL_CHUNK_MAX, "blob chunk")
    };
  },
  "machine.blob_done": (v) => ({
    type: "event",
    kind: "machine.blob_done",
    id: blobId2(eventFields(v, ["id"]))
  }),
  "machine.blob_abort": (v) => {
    const m = eventFields(v, ["id", "reason"]);
    return {
      type: "event",
      kind: "machine.blob_abort",
      id: blobId2(m),
      reason: oneOf(MACHINE_BLOB_ABORT_REASONS, m["reason"], "blob abort reason")
    };
  }
};

// packages/local-api/src/validate-events.ts
var revisionOf = (m) => uint(m["revision"], 1, Number.MAX_SAFE_INTEGER, "revision");
var devicesOf = (v) => {
  if (!isRecord(v))
    return fail2("round devices");
  const out = {};
  for (const [device, state] of Object.entries(v))
    out[safeKey(deviceId(device), "round device")] = oneOf(ROUND_DEVICE_STATES, state, "round device state");
  return out;
};
var commandStateOf = (v) => {
  const m = eventFields(v, ["command_id", "state", "retryable"], ["reason", "receipt"]);
  const state = oneOf(COMMAND_STATES, m["state"], "command state");
  if (bool(m["retryable"], "retryable") !== RETRYABLE_STATES.includes(state))
    return fail2("retryable");
  const head = {
    type: "event",
    kind: "session.command_state",
    command_id: commandId(m["command_id"]),
    ...m["receipt"] === undefined ? {} : { receipt: jsonObject(m["receipt"], "receipt") }
  };
  const reason = m["reason"];
  switch (state) {
    case "engine_refused":
      return {
        ...head,
        state,
        reason: oneOf(COMMAND_REFUSAL_REASONS, reason, "refusal reason"),
        retryable: false
      };
    case "uncertain":
      return {
        ...head,
        state,
        reason: oneOf(COMMAND_UNCERTAIN_REASONS, reason, "uncertain reason"),
        retryable: false
      };
    case "not confirmed":
    case "not delivered: never_sent":
      return reason === undefined ? { ...head, state, retryable: true } : fail2("reason");
    case "queued":
    case "transport_confirmed":
    case "engine_dispatched":
    case "engine_applied":
    case "engine_stale":
      return reason === undefined ? { ...head, state, retryable: false } : fail2("reason");
  }
};
var VALIDATORS = {
  ...STREAM_EVENT_VALIDATORS,
  ...MACHINE_EVENT_VALIDATORS,
  ...DELEGATED_EVENT_VALIDATORS,
  "status.changed": (v) => ({
    type: "event",
    kind: "status.changed",
    status: statusOf(eventFields(v, ["status"])["status"])
  }),
  "sessions.round": (v) => {
    const m = eventFields(v, ["query_id", "state", "devices"]);
    const state = oneOf(ROUND_STATES, m["state"], "round state");
    return {
      type: "event",
      kind: "sessions.round",
      query_id: queryOf(m),
      state,
      devices: devicesOf(m["devices"])
    };
  },
  "sessions.listing_begin": (v) => {
    const m = eventFields(v, ["query_id", "revision"]);
    return {
      type: "event",
      kind: "sessions.listing_begin",
      query_id: queryOf(m),
      revision: revisionOf(m)
    };
  },
  "sessions.listing_rows": (v) => {
    const m = eventFields(v, ["query_id", "revision", "rows"]);
    const rows = m["rows"];
    if (!Array.isArray(rows) || rows.length === 0)
      return fail2("rows");
    return {
      type: "event",
      kind: "sessions.listing_rows",
      query_id: queryOf(m),
      revision: revisionOf(m),
      rows: rows.map(listingRowOf)
    };
  },
  "sessions.listing_end": (v) => {
    const m = eventFields(v, ["query_id", "revision", "incomplete"]);
    const incomplete = m["incomplete"];
    if (!Array.isArray(incomplete))
      return fail2("incomplete");
    const devices = incomplete.map((d) => deviceId(d));
    return {
      type: "event",
      kind: "sessions.listing_end",
      query_id: queryOf(m),
      revision: revisionOf(m),
      incomplete: devices
    };
  },
  "session.command_state": commandStateOf,
  "session.read_result": (v) => {
    const m = eventFields(v, ["attach", "query_id", "entries", "next_before"]);
    const entries = m["entries"];
    if (!Array.isArray(entries) || entries.length > SESSION_READ_TAIL_MAX)
      return fail2("entries");
    const rows = entries.map(readEntryOf);
    if (new Set(rows.map((r) => r.entry_id)).size !== rows.length)
      return fail2("duplicate entry_id");
    const next_before = nullable(m["next_before"], (e) => entryId(e, "next_before"));
    return {
      type: "event",
      kind: "session.read_result",
      attach: attachOf(m),
      query_id: queryOf(m),
      entries: rows,
      next_before
    };
  },
  "session.upload_abort": (v) => {
    const m = eventFields(v, ["upload_id", "reason"]);
    const reason = oneOf(UPLOAD_ABORT_REASONS, m["reason"], "upload abort reason");
    return {
      type: "event",
      kind: "session.upload_abort",
      upload_id: localId(m["upload_id"], "upload_id"),
      reason
    };
  }
};
var EVENT_KINDS = keysOf(VALIDATORS);

// packages/local-api/src/validate-requests.ts
var ENVIRONMENTS_MAX2 = 1024;
var PKCS8_KEY_BYTES = 48;
var PKCS8_PREFIX = {
  ed25519: "302e020100300506032b657004220420",
  x25519: "302e020100300506032b656e04220420"
};
var pkcs8 = (v, algorithm, what) => {
  const bytes = base64Bytes(v, PKCS8_KEY_BYTES, what);
  const prefix = Buffer.from(bytes.subarray(0, 16)).toString("hex");
  const exact = bytes.length === PKCS8_KEY_BYTES && prefix === PKCS8_PREFIX[algorithm];
  return exact && typeof v === "string" ? v : fail2(what);
};
var filterOf = (v) => {
  const { device, project, state } = exactly(v, [], FILTER_KEYS, "filter");
  return {
    ...device === undefined ? {} : { device: deviceId(device, "filter.device") },
    ...project === undefined ? {} : { project: text(project, SESSION_PROJECT_MAX_CHARS, "filter.project") },
    ...state === undefined ? {} : { state: SESSION_ROW_STATES.find((s) => s === state) ?? fail2("filter.state") }
  };
};
var environmentsOf = (v) => {
  if (!Array.isArray(v) || v.length > ENVIRONMENTS_MAX2)
    return fail2("environments");
  const rows = v.map((e) => {
    const m = exactly(e, ["environment_id", "revoked", "closed"], [], "environment");
    return {
      environment_id: text(m["environment_id"], 128, "environment_id"),
      revoked: uint(m["revoked"], 0, Number.MAX_SAFE_INTEGER, "revoked"),
      closed: uint(m["closed"], 0, Number.MAX_SAFE_INTEGER, "closed")
    };
  });
  return new Set(rows.map((r) => r.environment_id)).size === rows.length ? rows : fail2("duplicate environment_id");
};
var bare2 = (v) => {
  requestFields(v, []);
};
var VALIDATORS2 = {
  ...COMMAND_REQUEST_VALIDATORS,
  ...MACHINE_REQUEST_VALIDATORS,
  ...DELEGATED_REQUEST_VALIDATORS,
  authenticate: (v, id) => {
    const m = requestFields(v, ["client_proof"]);
    return { id, type: "authenticate", client_proof: text(m["client_proof"], 64, "client_proof") };
  },
  "status.get": (v, id) => {
    bare2(v);
    return { id, type: "status.get" };
  },
  "status.subscribe": (v, id) => {
    bare2(v);
    return { id, type: "status.subscribe" };
  },
  "control.attach.get": (v, id) => {
    bare2(v);
    return { id, type: "control.attach.get" };
  },
  "control.attach.set": (v, id) => {
    const attached = bool(requestFields(v, ["attached"])["attached"], "attached");
    return { id, type: "control.attach.set", attached };
  },
  "control.remote_commands.get": (v, id) => {
    bare2(v);
    return { id, type: "control.remote_commands.get" };
  },
  "control.remote_commands.set": (v, id) => {
    const enabled = bool(requestFields(v, ["enabled"])["enabled"], "enabled");
    return { id, type: "control.remote_commands.set", enabled };
  },
  "service.set_enabled": (v, id) => {
    const enabled = bool(requestFields(v, ["enabled"])["enabled"], "enabled");
    return { id, type: "service.set_enabled", enabled };
  },
  "refresher.register": (v, id) => {
    const m = requestFields(v, ["binary_path", "version"]);
    const binary_path = absolutePath(m["binary_path"], "binary_path");
    return {
      id,
      type: "refresher.register",
      binary_path,
      version: semver(m["version"], "version")
    };
  },
  "device.adopt": (v, id) => {
    const m = requestFields(v, ["device", "signing_private_key", "sealing_private_key"]);
    return {
      id,
      type: "device.adopt",
      device: deviceRef(m["device"]),
      signing_private_key: pkcs8(m["signing_private_key"], "ed25519", "signing_private_key"),
      sealing_private_key: pkcs8(m["sealing_private_key"], "x25519", "sealing_private_key")
    };
  },
  "device.forget": (v, id) => {
    bare2(v);
    return { id, type: "device.forget" };
  },
  "device.info": (v, id) => {
    bare2(v);
    return { id, type: "device.info" };
  },
  "endpoints.register": endpointsRegister,
  "endpoints.unregister": endpointsUnregister,
  "devices.list": (v, id) => {
    bare2(v);
    return { id, type: "devices.list" };
  },
  "sessions.list": (v, id) => {
    const { filter, rows } = requestFields(v, [], ["filter", "rows"]);
    if (rows !== undefined && rows !== 2)
      return fail2("rows");
    return {
      id,
      type: "sessions.list",
      ...filter === undefined ? {} : { filter: filterOf(filter) },
      ...rows === undefined ? {} : { rows }
    };
  },
  "session.attach": (v, id) => {
    const m = requestFields(v, ["device", "session_id"]);
    return {
      id,
      type: "session.attach",
      device: deviceId(m["device"]),
      session_id: sessionId(m["session_id"])
    };
  },
  "session.detach": (v, id) => ({
    id,
    type: "session.detach",
    attach: localId(requestFields(v, ["attach"])["attach"], "attach")
  }),
  "session.read": (v, id) => {
    const m = requestFields(v, ["attach"], ["before_entry_id", "tail"]);
    const before = m["before_entry_id"];
    const tail = m["tail"];
    return {
      id,
      type: "session.read",
      attach: localId(m["attach"], "attach"),
      ...before === undefined ? {} : { before_entry_id: entryId(before, "before_entry_id") },
      ...tail === undefined ? {} : { tail: uint(tail, 1, SESSION_READ_TAIL_MAX, "tail") }
    };
  },
  "enforcement.report": (v, id) => {
    const m = requestFields(v, ["generation", "data_home", "environments", "complete"]);
    return {
      id,
      type: "enforcement.report",
      generation: uint(m["generation"], 0, Number.MAX_SAFE_INTEGER, "generation"),
      data_home: absolutePath(m["data_home"], "data_home"),
      environments: environmentsOf(m["environments"]),
      complete: bool(m["complete"], "complete")
    };
  },
  "owner.shutdown_for_upgrade": (v, id) => {
    const target_version = semver(requestFields(v, ["target_version"])["target_version"], "target_version");
    return { id, type: "owner.shutdown_for_upgrade", target_version };
  }
};
var REQUEST_TYPES = keysOf(VALIDATORS2);

// packages/local-api/src/validate.ts
var asViolation = (check) => {
  try {
    return check();
  } catch (error) {
    if (error instanceof InvalidMessage)
      throw new LocalApiError("protocol_violation", error.detail);
    throw error;
  }
};
var validateWelcome = (v) => asViolation(() => {
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
    "state"
  ];
  const m = exactly(v, fields, [], "welcome");
  const capabilities = m["capabilities"];
  if (m["type"] !== "welcome" || m["owner"] !== "service")
    return fail2("welcome");
  if (!Array.isArray(capabilities) || new Set(capabilities).size !== capabilities.length)
    return fail2("capabilities");
  return {
    type: "welcome",
    v: LOCAL_API_VERSION,
    service_version: semver(m["service_version"], "service_version"),
    owner: "service",
    server_proof: nonce(m["server_proof"], "server_proof"),
    server_nonce: nonce(m["server_nonce"], "server_nonce"),
    capabilities: capabilities.map((c) => oneOf([...CAPABILITIES, ...OPTIONAL_CAPABILITIES], c, "capability")),
    state: statusOf(m["state"])
  };
});
var empty2 = (v) => {
  exactly(v, [], [], "data");
  return {};
};
var one = (v, name) => exactly(v, [name], [], "data")[name];
var attachState = (v) => {
  const m = exactly(v, ["attached", "changedAt"], [], "data");
  const changedAt = m["changedAt"];
  return {
    attached: bool(m["attached"], "attached"),
    changedAt: typeof changedAt === "string" ? changedAt : fail2("changedAt")
  };
};
var remoteCommandsState = (v) => {
  const m = exactly(v, ["enabled", "changedAt", "overridden"], [], "data");
  const changedAt = m["changedAt"];
  return {
    enabled: bool(m["enabled"], "enabled"),
    changedAt: typeof changedAt === "string" ? changedAt : fail2("changedAt"),
    overridden: bool(m["overridden"], "overridden")
  };
};
var DATA = {
  authenticate: empty2,
  "status.get": statusOf,
  "status.subscribe": empty2,
  "service.set_enabled": (v) => ({ enabled: bool(one(v, "enabled"), "enabled") }),
  "refresher.register": empty2,
  "device.adopt": (v) => ({ device: deviceRef(one(v, "device")) }),
  "device.forget": empty2,
  "device.info": (v) => ({ device: nullable(one(v, "device"), (d) => deviceRef(d)) }),
  "endpoints.register": empty2,
  "endpoints.unregister": empty2,
  "devices.list": (v) => {
    const devices = one(v, "devices");
    return Array.isArray(devices) ? { devices: devices.map(deviceRowOf) } : fail2("devices");
  },
  "sessions.list": (v) => ({ query_id: localId(one(v, "query_id"), "query_id") }),
  "session.attach": (v) => ({ attach: localId(one(v, "attach"), "attach") }),
  "session.detach": empty2,
  "session.command": commandAnswerOf,
  "session.command_part": (v) => ({
    received: uint(one(v, "received"), 0, LOCAL_UPLOAD_PARTS_MAX - 1, "received")
  }),
  "session.read": (v) => ({ query_id: localId(one(v, "query_id"), "query_id") }),
  "enforcement.report": empty2,
  "owner.shutdown_for_upgrade": empty2,
  "control.attach.get": attachState,
  "control.attach.set": attachState,
  "control.remote_commands.get": remoteCommandsState,
  "control.remote_commands.set": remoteCommandsState,
  "session.endpoints": endpointsData,
  "session.locate": (v) => refOf(v, "session.locate data"),
  ...MACHINE_DATA
};
// packages/local-api/src/access.ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";

// packages/local-api/src/dacl.ts
var APPLY_DACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$sid = New-Object System.Security.Principal.SecurityIdentifier($env:LA_SID)
if ($env:LA_KIND -eq 'dir') {
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
} else {
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $inherit = [System.Security.AccessControl.InheritanceFlags]::None
}
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid,
  [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit,
  [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
$acl.SetAccessRuleProtection($true, $false)
$acl.SetOwner($sid)
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $env:LA_PATH -AclObject $acl
Write-Output 'applied'
`;
var DESCRIBE_DACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class LaSddl {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
  static extern uint GetNamedSecurityInfoW(string name, int type, int info, out IntPtr owner, out IntPtr group,
    out IntPtr dacl, out IntPtr sacl, out IntPtr sd);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(IntPtr sd, int revision, int info,
    out IntPtr text, out int length);
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr memory);
  public static string Read(string path) {
    IntPtr owner, group, dacl, sacl, sd;
    uint code = GetNamedSecurityInfoW(path, 1, 5, out owner, out group, out dacl, out sacl, out sd);
    if (code != 0) throw new Win32Exception((int)code);
    try {
      IntPtr text; int length;
      if (!ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, 1, 5, out text, out length))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      try { return Marshal.PtrToStringUni(text); } finally { LocalFree(text); }
    } finally { LocalFree(sd); }
  }
}
'@
[LaSddl]::Read($env:LA_PATH)
`;
var ACE_TYPES = new Set([
  "A",
  "D",
  "OA",
  "OD",
  "AU",
  "AL",
  "OU",
  "OL",
  "ML",
  "XA",
  "XD",
  "ZA",
  "XU",
  "SP",
  "RA",
  "SD",
  "CA"
]);

// packages/local-api/src/access.ts
var TOKEN_FILE = "token";
var TOKEN_BYTES = 32;
var NONCE_BYTES = 32;
var SOCKET_FILE = "service.sock";
var base64url = (bytes) => Buffer.from(bytes).toString("base64url");
var mintNonce = () => base64url(randomBytes(NONCE_BYTES));
var mintId = () => base64url(randomBytes(16));
var insecure = (detail) => {
  throw new LocalApiError("insecure_state_dir", detail);
};
var decoded = (value, bytes, what) => {
  const out = Buffer.from(value, "base64url");
  if (out.length !== bytes || base64url(out) !== value)
    throw new LocalApiError("protocol_violation", `${what} is not ${bytes} base64url bytes`);
  return out;
};
var UNIX_ENDPOINT = "unix";
var tcpEndpoint = (port) => `tcp:${port}`;
var proof = (token, label, nonce, endpoint) => base64url(createHmac("sha256", token).update(label).update(decoded(nonce, NONCE_BYTES, "a nonce")).update(endpoint, "utf8").digest());
var serverProof = (token, clientNonce, endpoint) => proof(token, "server", clientNonce, endpoint);
var clientProof = (token, serverNonce, endpoint) => proof(token, "client", serverNonce, endpoint);
var proofMatches = (expected, actual) => {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
};
var isMissing = (error) => typeof error === "object" && error !== null && ("code" in error) && (error.code === "ENOENT" || error.code === "ENOTDIR");
var currentUid = () => process.getuid?.() ?? insecure("this platform has no uid");
var privateEntry = (path, kind, uid, checkMode = true) => {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (isMissing(error))
      return insecure(`the ${kind} is missing`);
    throw error;
  }
  const isKind = kind === "dir" ? stat.isDirectory() : kind === "socket" ? stat.isSocket() : stat.isFile();
  if (!isKind)
    insecure(`the ${kind} is not a plain ${kind}`);
  if (stat.uid !== uid)
    insecure(`the ${kind} belongs to another user`);
  if (checkMode && (stat.mode & 63) !== 0)
    insecure(`the ${kind} is open to group or others`);
};
var checkPosixAccess = (stateDir) => {
  const uid = currentUid();
  privateEntry(stateDir, "dir", uid);
  privateEntry(join(stateDir, SOCKET_FILE), "socket", uid);
  privateEntry(join(stateDir, TOKEN_FILE), "file", uid);
};
var readToken = (stateDir) => {
  let value;
  try {
    value = readFileSync(join(stateDir, TOKEN_FILE), "utf8");
  } catch (error) {
    if (isMissing(error))
      return insecure("the token is missing");
    throw error;
  }
  try {
    return decoded(value, TOKEN_BYTES, "the token");
  } catch (error) {
    if (error instanceof LocalApiError)
      return insecure("the token is malformed");
    throw error;
  }
};
// packages/local-api/src/transport.ts
import { lstatSync as lstatSync2, readFileSync as readFileSync2, unlinkSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { join as join2 } from "node:path";
var ENDPOINT_FILE = "endpoint.json";
var wrap = (socket, endpoint) => {
  const closeListeners = [];
  let closed = false;
  socket.on("close", () => {
    closed = true;
    for (const listener of closeListeners.splice(0))
      listener();
  });
  socket.on("error", () => {});
  return {
    endpoint,
    write: (bytes) => {
      if (!closed)
        socket.write(bytes);
    },
    close: () => {
      socket.end();
    },
    destroy: () => {
      socket.destroy();
    },
    onData: (listener) => {
      socket.on("data", (chunk) => listener(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
    },
    onClose: (listener) => {
      if (closed)
        listener();
      else
        closeListeners.push(listener);
    }
  };
};
var readEndpointPort = (stateDir) => {
  const parsed = JSON.parse(readFileSync2(join2(stateDir, ENDPOINT_FILE), "utf8"));
  const port = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "port") : undefined;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new LocalApiError("insecure_state_dir", "endpoint.json holds no port");
  return port;
};
var connectLocal = (stateDir) => new Promise((resolve, reject) => {
  const port = process.platform === "win32" ? readEndpointPort(stateDir) : undefined;
  const endpoint = port === undefined ? UNIX_ENDPOINT : tcpEndpoint(port);
  const socket = port === undefined ? createConnection({ path: join2(stateDir, SOCKET_FILE) }) : createConnection({ host: "127.0.0.1", port });
  socket.once("error", reject);
  socket.once("connect", () => {
    socket.off("error", reject);
    resolve(wrap(socket, endpoint));
  });
});
// packages/bunshin-ts-relay/src/connection.ts
import { existsSync } from "node:fs";

// packages/bunshin-ts-relay/src/errors.ts
class RelayTransportError extends Error {
  code;
  requestId;
  constructor(code, message, cause, requestId) {
    super(`${code}: ${message}`, cause === undefined ? undefined : { cause });
    this.name = "RelayTransportError";
    this.code = code;
    this.requestId = requestId;
  }
}

class WireRefusal extends Error {
  code;
  reason;
  constructor(code, reason) {
    super(`${code}: ${reason}`);
    this.name = "WireRefusal";
    this.code = code;
    this.reason = reason;
  }
}
var CONNECT_FAILURES = new Set(["ENOENT", "ECONNREFUSED", "ENOTDIR", "EACCES"]);
var errnoOf = (error) => typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
var transportErrorOf = (error) => {
  if (error instanceof RelayTransportError)
    return error;
  if (error instanceof WireRefusal && error.code === "unsupported")
    return new RelayTransportError("unsupported", error.reason, error);
  if (error instanceof LocalApiError)
    switch (error.code) {
      case "server_proof_invalid":
      case "insecure_state_dir":
      case "refused":
      case "request_timeout":
      case "closed":
        return new RelayTransportError(error.code, error.reason, error);
      case "handshake_timeout":
        return new RelayTransportError("not_connected", error.reason, error);
      default:
        return error;
    }
  if (CONNECT_FAILURES.has(String(errnoOf(error))))
    return new RelayTransportError("not_connected", "the device service is not listening", error);
  return error;
};

// packages/bunshin-ts-relay/src/types.ts
var RELAY_STATUS_STATES = [
  "not_configured",
  "disabled",
  "sign_in_required",
  "plan_required",
  "keychain_locked",
  "connecting",
  "activation_pending",
  "connected",
  "offline",
  "authorization_stale",
  "service_degraded",
  "update_required",
  "signed_out"
];
var OUTPUT_CREDIT_BYTES = 65536;

// packages/bunshin-ts-relay/src/wire.ts
var realTimer = (expire, ms) => {
  const timer = setTimeout(expire, ms);
  return () => clearTimeout(timer);
};
var field = (value, name) => typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
var refusalOf = (message) => {
  const error = field(message, "error");
  const code = field(error, "code");
  const reason = field(error, "reason");
  if (typeof code !== "string" || typeof reason !== "string")
    throw new LocalApiError("protocol_violation", "an error response without code and reason");
  return new WireRefusal(code, reason);
};

class Wire {
  #transport;
  #timer;
  #timeoutMs;
  #pending = new Map;
  #listeners = new Set;
  #first;
  #takeFirst;
  #next = 1;
  #ended = false;
  closed;
  constructor(transport, timer, timeoutMs) {
    this.#transport = transport;
    this.#timer = timer;
    this.#timeoutMs = timeoutMs;
    this.#first = new Promise((resolve, reject) => {
      this.#takeFirst = { resolve, reject };
    });
    const decoder = new LineDecoder((line) => this.#onLine(line), () => this.#violation("a line over LOCAL_LINE_MAX"));
    transport.onData((bytes) => decoder.push(bytes));
    this.closed = new Promise((resolve) => transport.onClose(() => {
      this.#ended = true;
      this.#failAll(new LocalApiError("closed", "the connection closed"));
      resolve();
    }));
  }
  get endpoint() {
    return this.#transport.endpoint;
  }
  get ended() {
    return this.#ended;
  }
  send(message) {
    this.#transport.write(encodeLine(message));
  }
  firstMessage() {
    return this.#first;
  }
  onEvent(listener) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }
  request(type, params = {}) {
    if (this.#ended)
      return Promise.reject(new LocalApiError("closed", "the connection is closed"));
    const id = String(this.#next);
    this.#next += 1;
    const message = { id, type, ...params };
    if (lineBytes(message) > LOCAL_INLINE_MAX)
      return Promise.reject(new LocalApiError("protocol_violation", `${type} over LOCAL_INLINE_MAX`));
    return new Promise((resolve, reject) => {
      const cancel = this.#timer(() => {
        if (this.#pending.get(id) === undefined)
          return;
        const forget = this.#timer(() => this.#pending.delete(id), this.#timeoutMs);
        this.#pending.set(id, { settle: forget, fail: forget });
        reject(new LocalApiError("request_timeout", `the service did not answer ${type} in time`));
      }, this.#timeoutMs);
      this.#pending.set(id, {
        settle: (response) => {
          cancel();
          if (field(response, "ok") === true)
            resolve(field(response, "data"));
          else
            reject(refusalOf(response));
        },
        fail: (error) => {
          cancel();
          reject(error);
        }
      });
      this.send(message);
    });
  }
  close() {
    this.#transport.close();
  }
  destroy() {
    this.#transport.destroy();
  }
  #onLine(line) {
    try {
      const message = parseLine(line);
      const first = this.#takeFirst;
      if (first !== undefined) {
        this.#takeFirst = undefined;
        return first.resolve(message);
      }
      const type = field(message, "type");
      if (type === "response")
        return this.#settle(message);
      const kind = field(message, "kind");
      if (type === "event" && typeof kind === "string") {
        const event = { ...message, kind };
        for (const listener of [...this.#listeners])
          listener(event);
        return;
      }
      this.#violation("a message that is neither a response nor an event");
    } catch (error) {
      this.#violation(error instanceof LocalApiError ? error.reason : `an unusable line: ${String(error)}`);
    }
  }
  #settle(message) {
    const id = field(message, "id");
    const pending = typeof id === "string" ? this.#pending.get(id) : undefined;
    if (typeof id !== "string" || pending === undefined)
      return this.#violation("a response to no pending request");
    this.#pending.delete(id);
    pending.settle(message);
  }
  #violation(detail) {
    this.#failAll(new LocalApiError("protocol_violation", detail));
    this.#transport.destroy();
  }
  #failAll(error) {
    this.#takeFirst?.reject(error);
    this.#takeFirst = undefined;
    for (const pending of this.#pending.values())
      pending.fail(error);
    this.#pending.clear();
  }
}

// packages/bunshin-ts-relay/src/connection.ts
var HANDSHAKE_TIMEOUT_MS = 1e4;
var REQUEST_TIMEOUT_MS = 30000;
var handshake = async (wire, options) => {
  const nonce = mintNonce();
  wire.send({
    type: "hello",
    v: LOCAL_API_VERSION,
    client: { name: options.clientName, version: options.clientVersion },
    client_nonce: nonce
  });
  const welcome = validateWelcome(await wire.firstMessage());
  if (welcome.type === "refused")
    throw new LocalApiError("refused", welcome.reason);
  const token = readToken(options.stateDir);
  if (!proofMatches(serverProof(token, nonce, wire.endpoint), welcome.server_proof))
    throw new LocalApiError("server_proof_invalid", "the service did not prove the per-boot token");
  await wire.request("authenticate", {
    client_proof: clientProof(token, welcome.server_nonce, wire.endpoint)
  });
};
var bounded = (wire, options) => new Promise((resolve, reject) => {
  const cancel = (options.timer ?? realTimer)(() => {
    wire.destroy();
    reject(new LocalApiError("handshake_timeout", "the service did not complete the handshake"));
  }, HANDSHAKE_TIMEOUT_MS);
  handshake(wire, options).then(resolve, reject).finally(cancel);
});
var openConnection = async (options) => {
  try {
    if (!existsSync(options.stateDir))
      throw new RelayTransportError("not_connected", "no device service state dir");
    if (process.platform !== "win32")
      checkPosixAccess(options.stateDir);
    const transport = await (options.transport ?? connectLocal)(options.stateDir);
    const wire = new Wire(transport, options.timer ?? realTimer, options.requestTimeoutMs);
    try {
      await bounded(wire, options);
    } catch (error) {
      wire.destroy();
      throw error;
    }
    return wire;
  } catch (error) {
    throw transportErrorOf(error);
  }
};
var isState = (value) => RELAY_STATUS_STATES.some((state) => state === value);
var deviceOf = (value) => {
  if (value === null || typeof value !== "object")
    return null;
  const id = Reflect.get(value, "id");
  const name = Reflect.get(value, "name");
  return typeof id === "string" && typeof name === "string" ? { id, name } : null;
};
var statusOf2 = async (wire) => {
  const data = await wire.request("status.get").catch((error) => {
    throw transportErrorOf(error);
  });
  const state = typeof data === "object" && data !== null ? Reflect.get(data, "state") : undefined;
  if (!isState(state))
    throw new LocalApiError("protocol_violation", "status.get answered without a known state");
  return { state, device: deviceOf(Reflect.get(data ?? {}, "device")), connected: true };
};

// packages/bunshin-ts-relay/src/env.ts
import { homedir } from "node:os";
import { join as join3 } from "node:path";
var STATE_DIR_ENV = "OMO_DEVICE_SERVICE_STATE_DIR";
var SESSION_REF_ENV = "PI_SESSION_ID";
var SESSION_REF_MAX_CHARS = 128;
var defaultStateDir = (env = process.env, home = homedir(), platform = process.platform) => {
  const override = env[STATE_DIR_ENV];
  if (override !== undefined && override !== "")
    return override;
  return platform === "win32" ? join3(env["LOCALAPPDATA"] ?? join3(home, "AppData", "Local"), "OmO", "device-service") : join3(home, ".omo", "device-service");
};
var sessionRefFromEnv = (env = process.env) => {
  const raw = env[SESSION_REF_ENV]?.trim();
  return raw === undefined || raw === "" || raw.length > SESSION_REF_MAX_CHARS ? undefined : raw;
};

// packages/bunshin-ts-relay/vendor/bunshin-ts/errors.ts
class CapabilityUnavailableError extends Error {
  machineId;
  capability;
  constructor(machineId, capability) {
    super(`capability unavailable on machine ${machineId}: ${capability}`);
    this.name = "CapabilityUnavailableError";
    this.machineId = machineId;
    this.capability = capability;
  }
}

class CapabilityTokenMintError extends Error {
  status;
  code;
  constructor(status, code, message, options) {
    super(`capability token mint failed [${code}]: ${message}`, options);
    this.name = "CapabilityTokenMintError";
    this.status = status;
    this.code = code;
  }
}

class HubTransportError extends Error {
  code;
  requestId;
  detail;
  result;
  constructor(code, message, requestId = "", detail, result) {
    super(`hub transport error [${code}]: ${message}`);
    this.name = "HubTransportError";
    this.code = code;
    this.requestId = requestId;
    this.detail = detail;
    this.result = result;
  }
}

class MachineWireError extends HubTransportError {
  disposition;
  constructor(code, message, requestId = "", disposition, detail) {
    super(code, message, requestId, detail);
    this.name = new.target.name;
    this.disposition = disposition;
  }
}

// packages/bunshin-ts-relay/src/capability-token.ts
var DEFAULT_TOKEN_TTL_MS = 15 * 60000;
var malformed = (message) => {
  throw new CapabilityTokenMintError(400, "malformed_input", message);
};
var nonEmpty = (value) => typeof value === "string" && value !== "";
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var mintCapabilityToken = (input, now = Date.now()) => {
  if (!nonEmpty(input.machineId))
    return malformed("machineId must be a non-empty string");
  if (!Array.isArray(input.allowedOps) || input.allowedOps.length === 0)
    return malformed("allowedOps must name at least one op");
  if (!input.allowedOps.every(nonEmpty))
    return malformed("every allowed op must be a non-empty string");
  if (!nonEmpty(input.pathJail))
    return malformed("pathJail must be a non-empty string");
  if (input.argConstraints !== undefined && !isRecord2(input.argConstraints))
    return malformed("argConstraints must be an object");
  if (input.taskId !== undefined && !nonEmpty(input.taskId))
    return malformed("taskId must be a non-empty string");
  const ttl = input.ttlMs ?? DEFAULT_TOKEN_TTL_MS;
  if (!Number.isFinite(ttl) || ttl <= 0)
    return malformed("ttlMs must be a positive number");
  const nbf = input.notBefore ?? now;
  if (!Number.isFinite(nbf))
    return malformed("notBefore must be a finite number");
  const claims = {
    machineId: input.machineId,
    allowedOps: [...input.allowedOps],
    pathJail: input.pathJail,
    ...input.argConstraints === undefined ? {} : { argConstraints: input.argConstraints },
    ...input.taskId === undefined ? {} : { taskId: input.taskId },
    exp: now + ttl,
    nbf
  };
  return { token: Buffer.from(JSON.stringify(claims)).toString("base64url"), expiry: claims.exp };
};
var constraintsOf = (token) => {
  let claims;
  try {
    claims = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch (error) {
    throw new CapabilityTokenMintError(400, "malformed_token", "the token is not base64url JSON", {
      cause: error
    });
  }
  if (!isRecord2(claims) || !nonEmpty(claims["machineId"]) || !Array.isArray(claims["allowedOps"]))
    throw new CapabilityTokenMintError(400, "malformed_token", "the token carries no claims");
  return claims;
};

// packages/bunshin-ts-relay/src/events.ts
var TOPICS = new Set(["device", "job", "message"]);
var draftOf = (event, machineId) => {
  const field = (name) => {
    const value = event[name];
    return typeof value === "string" ? value : undefined;
  };
  if (event.kind === "machine.changed") {
    const device = field("device");
    const state = field("state");
    if (device === undefined || state === undefined)
      throw new LocalApiError("protocol_violation", "machine.changed is malformed");
    return { topic: "device", machineId: device, payload: { state } };
  }
  if (event.kind === "machine.op_state") {
    const opId = field("op_id");
    const state = field("state");
    if (opId === undefined || state === undefined)
      throw new LocalApiError("protocol_violation", "machine.op_state is malformed");
    return {
      topic: "job",
      ...machineId === undefined ? {} : { machineId },
      payload: { opId, state }
    };
  }
  return;
};
var openEvents = (feeds, options) => {
  if (options.topics.length === 0 || !options.topics.every((topic) => TOPICS.has(topic)))
    throw new TypeError("events() needs one or more of the topics device, job, message");
  const topics = new Set(options.topics);
  const machines = options.machineIds === undefined ? undefined : new Set(options.machineIds);
  const listeners = new Set;
  let seq = 0;
  let stop;
  const emit = (draft) => {
    if (draft === undefined || !topics.has(draft.topic))
      return;
    if (machines !== undefined && (draft.machineId === undefined || !machines.has(draft.machineId)))
      return;
    seq += 1;
    const event = { ...draft, seq, at: Date.now() };
    for (const listener of [...listeners])
      try {
        listener(event);
      } catch (error) {
        feeds.reportError(error);
      }
  };
  const start = () => {
    let wire;
    let stopped = false;
    const offOps = feeds.ops((event, machineId) => emit(draftOf(event, machineId)));
    const offClosed = feeds.closed(() => shutdown());
    feeds.open().then(async (opened) => {
      wire = opened;
      if (stopped)
        return opened.close();
      opened.onEvent((event) => emit(draftOf(event, undefined)));
      opened.closed.then(() => {
        if (!stopped)
          fail(new RelayTransportError("closed", "the events connection closed"));
      });
      await opened.request("machine.events.subscribe");
    }, (error) => fail(error)).catch((error) => fail(error));
    const shutdown = () => {
      if (stopped)
        return;
      stopped = true;
      offOps();
      offClosed();
      wire?.close();
    };
    return shutdown;
  };
  let failure;
  const failed = new Set;
  const fail = (error) => {
    failure = error;
    for (const notify of [...failed])
      notify(error);
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    stop ??= start();
    return () => {
      listeners.delete(listener);
      if (listeners.size > 0 || stop === undefined)
        return;
      stop();
      stop = undefined;
    };
  };
  const iterate = async function* () {
    const queue = [];
    let wake;
    const notify = () => wake?.();
    failed.add(notify);
    const off = subscribe((event) => {
      queue.push(event);
      notify();
    });
    try {
      for (;; ) {
        const next = queue.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (failure !== undefined)
          throw failure;
        await new Promise((resolve) => {
          wake = resolve;
        });
        wake = undefined;
      }
    } finally {
      failed.delete(notify);
      off();
    }
  };
  return { subscribe, [Symbol.asyncIterator]: iterate };
};

// packages/bunshin-ts-relay/src/blob.ts
var violation = (detail) => {
  throw new LocalApiError("protocol_violation", detail);
};

class BlobAssembler {
  #open = new Map;
  open(id, opId, bytes, sha256) {
    if (this.#open.has(id))
      return violation("a blob id opened twice");
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > LOCAL_BLOB_MAX)
      return violation("a result blob over LOCAL_BLOB_MAX");
    this.#open.set(id, { opId, bytes, sha256, parts: [], received: 0 });
  }
  chunk(id, off, b) {
    const blob = this.#current(id);
    const data = new Uint8Array(Buffer.from(b, "base64"));
    if (off !== blob.received || blob.received + data.length > blob.bytes)
      return violation("a result blob chunk out of order");
    blob.parts.push(data);
    blob.received += data.length;
  }
  done(id) {
    const blob = this.#current(id);
    this.#open.delete(id);
    if (blob.received !== blob.bytes)
      return violation("a result blob done before its last chunk");
    const data = new Uint8Array(blob.bytes);
    let at = 0;
    for (const part of blob.parts) {
      data.set(part, at);
      at += part.length;
    }
    return sha256Hex(data) === blob.sha256 ? { opId: blob.opId, data } : violation("a result blob digest mismatch");
  }
  abort(id) {
    const blob = this.#current(id);
    this.#open.delete(id);
    return blob.opId;
  }
  #current(id) {
    return this.#open.get(id) ?? violation("a result blob that is not open");
  }
}

// packages/bunshin-ts-relay/src/op-fields.ts
import { createHash as createHash2 } from "node:crypto";
var mintOpId = () => mintId();
var OP_ID = /^[A-Za-z0-9_-]{22}$/;
var wireOpIdOf = (opId) => OP_ID.test(opId) ? opId : createHash2("sha256").update(opId).digest().subarray(0, 16).toString("base64url");
var isRecord3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var violation2 = (detail) => {
  throw new LocalApiError("protocol_violation", detail);
};
var text2 = (event, name) => {
  const value = event[name];
  return typeof value === "string" ? value : violation2(`${event.kind} without ${name}`);
};
var entryOf = (value) => {
  if (!isRecord3(value) || typeof value["state"] !== "string")
    return violation2("an op result without a state");
  const error = value["error"];
  const code = isRecord3(error) ? error["code"] : undefined;
  if (error !== undefined && typeof code !== "string")
    return violation2("an op error without a code");
  const message = isRecord3(error) ? String(error["message"] ?? code) : "";
  return {
    state: value["state"],
    ..."response" in value ? { response: value["response"] } : {},
    ...typeof code === "string" ? { error: { code, message } } : {}
  };
};
var argsOf = (args) => {
  if (args === undefined)
    return {};
  const plain = JSON.parse(JSON.stringify(args));
  if (!isRecord3(plain))
    throw new TypeError("machine op args must be a JSON object");
  return plain;
};
var abortError = (signal) => signal.reason instanceof Error ? signal.reason : new DOMException("the operation was aborted", "AbortError");

// packages/bunshin-ts-relay/src/invoke.ts
class Invoker {
  #wire;
  #sessionRef;
  #timer;
  #timeoutMs;
  #pending = new Map;
  #running = new Map;
  #waiters = new Map;
  #blobs = new BlobAssembler;
  constructor(wire, sessionRef, timer, timeoutMs) {
    this.#wire = wire;
    this.#sessionRef = sessionRef;
    this.#timer = timer;
    this.#timeoutMs = timeoutMs;
    wire.onEvent((event) => this.#onEvent(event));
    wire.closed.then(() => {
      const closed = new RelayTransportError("closed", "the device service connection closed");
      for (const pending of this.#pending.values())
        pending.reject(closed);
      this.#pending.clear();
    });
  }
  machineOf(opId) {
    return this.#pending.get(opId)?.call.machineId;
  }
  invoke(call) {
    const { signal } = call;
    if (signal?.aborted === true)
      return Promise.reject(abortError(signal));
    const opId = call.opId === undefined ? mintOpId() : wireOpIdOf(call.opId);
    const running = this.#running.get(opId);
    if (running !== undefined)
      return running;
    const settled = this.#start(call, opId);
    this.#running.set(opId, settled);
    const forget = () => void this.#running.delete(opId);
    settled.then(forget, forget);
    return settled;
  }
  #start(call, opId) {
    const { signal } = call;
    const op = {
      op_id: opId,
      op: call.capability,
      args: argsOf(call.args),
      ...call.deadlineMs === undefined ? {} : { deadline_ms: call.deadlineMs },
      ...call.constraints === undefined ? {} : { constraints: call.constraints }
    };
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (signal === undefined || !this.#pending.delete(opId))
          return;
        const aborted = abortError(signal);
        this.#wire.request("machine.cancel", { op_ids: [opId] }).then(() => reject(aborted), (cancelError) => reject(Object.assign(aborted, { cause: cancelError })));
      };
      const done = () => signal?.removeEventListener("abort", onAbort);
      this.#pending.set(opId, {
        call,
        resolve: (value) => (done(), resolve(value)),
        reject: (error) => (done(), reject(error))
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#sendBatch(call.machineId, op, opId).catch((error) => {
        const pending = this.#pending.get(opId);
        if (pending === undefined)
          return;
        this.#pending.delete(opId);
        pending.reject(this.#batchError(error, opId));
      });
    });
  }
  async resultOf(requestId) {
    const opId = wireOpIdOf(requestId);
    let cancel = () => {};
    const terminal = new Promise((resolve) => {
      const waiter = (entry) => (cancel(), resolve(entry));
      this.#waiters.set(opId, [...this.#waiters.get(opId) ?? [], waiter]);
      cancel = () => this.#dropWaiter(opId, waiter);
    });
    const data = await this.#wire.request("machine.result_of", { op_id: opId }).catch((error) => {
      cancel();
      throw transportErrorOf(error);
    });
    const state = isRecord3(data) ? data["state"] : undefined;
    if (state === "terminal")
      return { state: "terminal", result: await this.#bounded(terminal, cancel) };
    cancel();
    if (state === "in_flight")
      return { state: "in-flight" };
    if (state === "unknown")
      throw new RelayTransportError("result_expired", `no result is held for ${requestId}`);
    return violation2("machine.result_of answered without a known state");
  }
  #bounded(terminal, cancel) {
    return new Promise((resolve, reject) => {
      const stop = this.#timer(() => {
        cancel();
        reject(new RelayTransportError("request_timeout", "the terminal result did not follow"));
      }, this.#timeoutMs);
      terminal.then((entry) => (stop(), resolve(entry)));
    });
  }
  #dropWaiter(opId, waiter) {
    const rest = (this.#waiters.get(opId) ?? []).filter((w) => w !== waiter);
    if (rest.length === 0)
      this.#waiters.delete(opId);
    else
      this.#waiters.set(opId, rest);
  }
  async#sendBatch(device, op, opId) {
    const ref = this.#sessionRef === undefined ? {} : { session_ref: this.#sessionRef };
    const inline = { device, ops: [op], ...ref };
    if (lineBytes({ id: "0".repeat(16), type: "machine.batch", ...inline }) <= LOCAL_INLINE_MAX) {
      await this.#wire.request("machine.batch", inline);
      return;
    }
    const upload_id = mintId();
    await Promise.all(uploadParts(JSON.stringify([op])).map((part) => this.#wire.request("machine.batch_part", { upload_id, ...part })));
    if (!this.#pending.has(opId))
      return;
    await this.#wire.request("machine.batch", { device, upload_id, ...ref });
  }
  #batchError(error, opId) {
    if (error instanceof WireRefusal && error.code !== "unsupported")
      return new MachineWireError(error.code, error.reason, opId);
    const mapped = transportErrorOf(error);
    if (mapped instanceof RelayTransportError && mapped.code === "request_timeout")
      return new RelayTransportError("request_timeout", `op ${opId} may have been dispatched; follow it with resultOf`, error, opId);
    return mapped;
  }
  #onEvent(event) {
    switch (event.kind) {
      case "machine.op_result": {
        const opId = text2(event, "op_id");
        const blob = event["blob"];
        if (!isRecord3(blob))
          return this.#settle(opId, entryOf(event["response"]));
        const { id, bytes, sha256 } = blob;
        if (typeof id !== "string" || typeof bytes !== "number" || typeof sha256 !== "string")
          return violation2("a result blob reference is malformed");
        return this.#blobs.open(id, opId, bytes, sha256);
      }
      case "machine.blob_chunk": {
        const off = event["off"];
        if (typeof off !== "number")
          return violation2("machine.blob_chunk without off");
        return this.#blobs.chunk(text2(event, "id"), off, text2(event, "b"));
      }
      case "machine.blob_done": {
        const { opId, data } = this.#blobs.done(text2(event, "id"));
        return this.#settle(opId, entryOf(JSON.parse(new TextDecoder().decode(data))));
      }
      case "machine.blob_abort": {
        const reason = text2(event, "reason");
        const opId = this.#blobs.abort(text2(event, "id"));
        return this.#settle(opId, {
          state: "failed",
          error: { code: reason, message: `the result blob was aborted: ${reason}` }
        });
      }
      default:
        return;
    }
  }
  #settle(opId, entry) {
    for (const waiter of this.#waiters.get(opId) ?? [])
      waiter(entry);
    const pending = this.#pending.get(opId);
    if (pending === undefined)
      return;
    this.#pending.delete(opId);
    if (entry.state === "applied")
      return pending.resolve(entry.response ?? null);
    const code = entry.error?.code ?? entry.state;
    if (code === "op_unknown")
      return pending.reject(new CapabilityUnavailableError(pending.call.machineId, pending.call.capability));
    pending.reject(new MachineWireError(code, entry.error?.message ?? `the op was ${entry.state}`, opId, undefined, entry));
  }
}

// packages/bunshin-ts-relay/src/output.ts
var UNREAD_MAX_BYTES = 16777216;

class OutputStreams {
  #streams = new Map;
  #credit;
  #unreadMax;
  #unread = 0;
  #ended = false;
  constructor(credit, unreadMax = UNREAD_MAX_BYTES) {
    this.#credit = credit;
    this.#unreadMax = unreadMax;
  }
  accept(event) {
    if (event.kind !== "machine.output")
      return;
    const { handle, seq, bytes } = event;
    if (typeof handle !== "string" || typeof seq !== "number" || typeof bytes !== "string")
      throw new LocalApiError("protocol_violation", "machine.output is malformed");
    const stream = this.#stream(handle);
    if (stream.next !== undefined && seq < stream.next)
      return;
    if (stream.next !== undefined && seq > stream.next)
      stream.items.push({ kind: "gap", missing: seq - stream.next });
    stream.next = seq + 1;
    const decoded = new Uint8Array(Buffer.from(bytes, "base64"));
    stream.items.push({ kind: "bytes", bytes: decoded });
    if (!stream.reading)
      this.#hold(stream, decoded.length);
    stream.wake?.();
  }
  #hold(stream, bytes) {
    stream.unread += bytes;
    this.#unread += bytes;
    for (const oldest of this.#streams.values()) {
      if (this.#unread <= this.#unreadMax)
        return;
      if (oldest.reading || oldest.unread === 0)
        continue;
      const missing = oldest.items.reduce((n, i) => n + (i.kind === "gap" ? i.missing : 1), 0);
      oldest.items.splice(0, oldest.items.length, { kind: "gap", missing });
      this.#unread -= oldest.unread;
      oldest.unread = 0;
    }
  }
  end() {
    this.#ended = true;
    for (const stream of this.#streams.values())
      stream.wake?.();
  }
  read(handle) {
    const stream = this.#stream(handle);
    stream.reading = true;
    this.#unread -= stream.unread;
    stream.unread = 0;
    return { [Symbol.asyncIterator]: () => this.#iterate(handle, stream) };
  }
  async* #iterate(handle, stream) {
    try {
      for (;; ) {
        if (stream.failure !== undefined)
          throw stream.failure;
        const item = stream.items.shift();
        if (item !== undefined) {
          if (item.kind === "bytes")
            this.#consumed(handle, stream, item.bytes.length);
          yield item;
          continue;
        }
        if (this.#ended)
          return;
        await new Promise((resolve) => {
          stream.wake = resolve;
        });
        stream.wake = undefined;
      }
    } finally {
      this.#streams.delete(handle);
    }
  }
  #consumed(handle, stream, bytes) {
    stream.consumed += bytes;
    while (stream.consumed >= OUTPUT_CREDIT_BYTES) {
      stream.consumed -= OUTPUT_CREDIT_BYTES;
      this.#credit(handle, OUTPUT_CREDIT_BYTES).catch((error) => {
        stream.failure = error;
        stream.wake?.();
      });
    }
  }
  #stream(handle) {
    const existing = this.#streams.get(handle);
    if (existing !== undefined)
      return existing;
    const created = {
      items: [],
      next: undefined,
      consumed: 0,
      wake: undefined,
      failure: undefined,
      reading: false,
      unread: 0
    };
    this.#streams.set(handle, created);
    return created;
  }
}

// packages/bunshin-ts-relay/src/policy.ts
var isRecord4 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var malformed2 = (field) => {
  throw new TypeError(`the device answered a policy whose ${field} is malformed`);
};
var strings = (value, field) => Array.isArray(value) && value.every((v) => typeof v === "string") ? value : malformed2(field);
var SOURCES = ["ssh_config", "tailscale", "manual"];
var sourceOf = (value) => SOURCES.find((s) => s === value) ?? malformed2("bridge.sources");
var targetOf3 = (value) => {
  if (!isRecord4(value) || typeof value["target"] !== "string")
    return malformed2("bridge.targets");
  const { target, enabled, hostKeyFp, home } = value;
  if (enabled !== undefined && typeof enabled !== "boolean")
    return malformed2("bridge.targets");
  if (home !== undefined && typeof home !== "string")
    return malformed2("bridge.targets");
  return {
    target,
    ...enabled === undefined ? {} : { enabled },
    ...hostKeyFp === undefined ? {} : { hostKeyFp: strings(hostKeyFp, "bridge.targets") },
    ...home === undefined ? {} : { home }
  };
};
var bridgeOf = (value) => {
  if (!isRecord4(value))
    return malformed2("bridge");
  const { enabled, sources, targets } = value;
  if (enabled !== undefined && typeof enabled !== "boolean")
    return malformed2("bridge.enabled");
  if (targets !== undefined && !Array.isArray(targets))
    return malformed2("bridge.targets");
  return {
    ...enabled === undefined ? {} : { enabled },
    ...sources === undefined ? {} : { sources: strings(sources, "bridge.sources").map(sourceOf) },
    ...targets === undefined ? {} : { targets: targets.map(targetOf3) }
  };
};
var policyOf2 = (value) => {
  if (!isRecord4(value))
    return malformed2("shape");
  const { tags, alias, pathAppend, longShellBudgetMs, bridge } = value;
  if (alias !== undefined && typeof alias !== "string")
    return malformed2("alias");
  if (longShellBudgetMs !== undefined && !Number.isInteger(longShellBudgetMs))
    return malformed2("longShellBudgetMs");
  return {
    ...tags === undefined ? {} : { tags: strings(tags, "tags") },
    ...alias === undefined ? {} : { alias },
    ...pathAppend === undefined ? {} : { pathAppend: strings(pathAppend, "pathAppend") },
    ...typeof longShellBudgetMs === "number" ? { longShellBudgetMs } : {},
    ...bridge === undefined ? {} : { bridge: bridgeOf(bridge) }
  };
};

// packages/bunshin-ts-relay/src/records.ts
var isRecord5 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var malformed3 = (what) => {
  throw new LocalApiError("protocol_violation", `${what} is malformed`);
};
var strings2 = (value) => Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
var text3 = (value) => typeof value === "string" ? value : undefined;
var STATES = new Set(["online", "offline", "unsupported"]);
var machineRowsOf = (data) => {
  const machines = isRecord5(data) ? data["machines"] : undefined;
  if (!Array.isArray(machines))
    return malformed3("machine.list");
  return machines.map((row) => {
    if (!isRecord5(row))
      return malformed3("a machine.list row");
    const { device, label, state } = row;
    if (typeof device !== "string" || typeof label !== "string" || !STATES.has(String(state)))
      return malformed3("a machine.list row");
    return {
      device,
      label,
      state: state === "online" ? "online" : state === "offline" ? "offline" : "unsupported"
    };
  });
};
var opsOf = (value) => (Array.isArray(value) ? value : []).flatMap((op) => {
  if (typeof op === "string")
    return [{ name: op }];
  if (!isRecord5(op) || typeof op["name"] !== "string")
    return [];
  const version = text3(op["version"]);
  const description = text3(op["description"]);
  return [
    {
      name: op["name"],
      ...version === undefined ? {} : { version },
      ...description === undefined ? {} : { description }
    }
  ];
});
var buildOf = (value) => {
  if (!isRecord5(value))
    return;
  const version = text3(value["version"]);
  const binarySha256 = text3(value["sha256"]) ?? text3(value["binarySha256"]);
  return version === undefined || binarySha256 === undefined ? undefined : { version, binarySha256 };
};
var hostOf = (value) => {
  if (!isRecord5(value))
    return;
  const { load1, cores } = value;
  return typeof load1 === "number" && typeof cores === "number" ? { load1, cores } : undefined;
};
var descriptionOf = (data) => {
  const description = isRecord5(data) ? data["description"] : undefined;
  if (!isRecord5(description))
    return malformed3("machine.describe");
  const os = text3(description["os"]);
  const arch = text3(description["arch"]);
  const build = buildOf(description["build"]);
  const host = hostOf(description["host"]);
  return {
    ...os === undefined ? {} : { os },
    ...arch === undefined ? {} : { arch },
    tags: strings2(description["tags"]),
    ...build === undefined ? {} : { build },
    ...host === undefined ? {} : { host },
    ops: opsOf(description["ops"]),
    features: strings2(description["features"])
  };
};
var recordOf = (row, description) => {
  const known = typeof description === "object" ? description : undefined;
  const unsupported = row.state === "unsupported" || description === "silent";
  const online = row.state !== "offline";
  return {
    id: row.device,
    alias: row.label,
    os: known?.os ?? "unknown",
    arch: known?.arch ?? "unknown",
    tags: known?.tags ?? [],
    state: online ? "online" : "offline",
    kind: "enrolled",
    routes: [
      {
        kind: "direct",
        machineId: row.device,
        online,
        capabilities: unsupported ? [] : known?.ops.map((op) => op.name) ?? []
      }
    ],
    connection: online ? "relay" : "none",
    protocolFeatures: unsupported ? [] : known?.features ?? [],
    ...known?.build === undefined ? {} : { build: known.build },
    ...known?.host === undefined ? {} : { host: known.host },
    ...unsupported ? { unsupported: true } : {}
  };
};
var toolsOf = (description) => description.ops.map((op) => ({
  name: op.name,
  capability: op.name,
  inputSchema: { type: "object", additionalProperties: true },
  transport: "built-in",
  version: op.version ?? "1",
  ...op.description === undefined ? {} : { description: op.description }
}));

// packages/bunshin-ts-relay/src/transport.ts
var SDK_TRANSPORT_VERSION = "0.1.0";
var DESCRIBE_TIMEOUT_MS = 1e4;
var createRelayTransport = (options = {}) => {
  const stateDir = options.stateDir ?? defaultStateDir();
  const sessionRef = options.sessionRef ?? sessionRefFromEnv();
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const describeTimeoutMs = options.describeTimeoutMs ?? DESCRIBE_TIMEOUT_MS;
  const open = () => openConnection({
    stateDir,
    clientName: options.clientName ?? "sdk",
    clientVersion: options.clientVersion ?? SDK_TRANSPORT_VERSION,
    requestTimeoutMs,
    ...options.timer === undefined ? {} : { timer: options.timer }
  });
  const descriptions = new Map;
  const opListeners = new Set;
  const closeListeners = new Set;
  let session;
  let closed = false;
  const start = async () => {
    const wire = await open();
    const invoker = new Invoker(wire, sessionRef, options.timer ?? defaultTimer, requestTimeoutMs);
    const output = new OutputStreams((handle, bytes) => wire.request("machine.credit", { handle, bytes }));
    wire.onEvent((event) => {
      output.accept(event);
      if (event.kind !== "machine.op_state")
        return;
      const opId = event["op_id"];
      const machineId = typeof opId === "string" ? invoker.machineOf(opId) : undefined;
      for (const listener of [...opListeners])
        listener(event, machineId);
    });
    wire.closed.then(() => output.end());
    return { wire, invoker, output };
  };
  const current = () => {
    if (closed)
      return Promise.reject(new RelayTransportError("closed", "the transport is closed"));
    if (session === undefined)
      return Promise.reject(new RelayTransportError("not_connected", "call connect() first"));
    return session;
  };
  const request = async (type, params = {}) => {
    const { wire } = await current();
    return wire.request(type, params).catch((error) => {
      throw transportErrorOf(error);
    });
  };
  const describe = async (device) => {
    const cached = descriptions.get(device);
    if (cached !== undefined)
      return cached;
    let stop = () => {};
    const silent = new Promise((resolve) => {
      stop = (options.timer ?? defaultTimer)(() => resolve("silent"), describeTimeoutMs);
    });
    const answer = request("machine.describe", { device }).then((data) => {
      const described = descriptionOf(data);
      descriptions.set(device, described);
      return described;
    }, (error) => {
      if (error instanceof RelayTransportError && error.code !== "request_timeout")
        throw error;
      return "silent";
    });
    const described = await Promise.race([answer, silent]).finally(stop);
    if (described === "silent")
      answer.catch(() => "silent");
    return described;
  };
  const recordFor = async (row) => {
    if (row.state === "unsupported")
      return recordOf(row, descriptions.get(row.device));
    const described = await describe(row.device);
    return recordOf(row, row.state === "offline" && described === "silent" ? undefined : described);
  };
  const invokeOp = async (machineId, capability, args, metadata, terminalTimeoutMs, signal) => {
    const { invoker } = await current();
    const token = metadata?.capabilityToken;
    return invoker.invoke({
      machineId,
      capability,
      args,
      ...metadata?.opId === undefined ? {} : { opId: metadata.opId },
      ...terminalTimeoutMs === undefined ? {} : { deadlineMs: terminalTimeoutMs },
      ...token === undefined ? {} : { constraints: constraintsOf(token) },
      ...signal === undefined ? {} : { signal }
    });
  };
  return {
    kind: "relay",
    connect: async () => {
      if (closed)
        throw new RelayTransportError("closed", "the transport is closed");
      session ??= start();
      try {
        await session;
      } catch (error) {
        session = undefined;
        throw error;
      }
    },
    close: async () => {
      if (closed)
        return;
      closed = true;
      for (const listener of [...closeListeners])
        listener();
      const opened = await session?.catch(() => {
        return;
      });
      opened?.wire.close();
    },
    listMachines: async () => {
      const rows = machineRowsOf(await request("machine.list"));
      return Promise.all(rows.map(recordFor));
    },
    listTools: async (machineId) => {
      const described = await describe(machineId);
      return described === "silent" ? [] : toolsOf(described);
    },
    invoke: invokeOp,
    resultOf: async (requestId) => (await current()).invoker.resultOf(requestId),
    events: (eventOptions) => openEvents({
      open,
      ops: (listener) => {
        opListeners.add(listener);
        return () => void opListeners.delete(listener);
      },
      closed: (listener) => {
        closeListeners.add(listener);
        return () => void closeListeners.delete(listener);
      },
      reportError: options.reportError ?? reportLater
    }, eventOptions),
    setPolicy: async (machineId, policy) => policyOf2(await invokeOp(machineId, "policy.set", { policy })),
    getPolicy: async (machineId) => policyOf2(await invokeOp(machineId, "policy.get", {})),
    mintCapabilityToken: async (input) => mintCapabilityToken(input),
    relayStatus: async () => statusOf2((await current()).wire),
    output: (handle) => ({
      [Symbol.asyncIterator]: async function* () {
        const { output } = await current();
        yield* output.read(handle);
      }
    })
  };
};
var reportLater = (error) => queueMicrotask(() => {
  throw error;
});
var defaultTimer = (expire, ms) => {
  const timer = setTimeout(expire, ms);
  return () => clearTimeout(timer);
};

// packages/bunshin-ts-relay/src/index.ts
var relayStatus = async (options = {}) => {
  let wire;
  try {
    wire = await openConnection({
      stateDir: options.stateDir ?? defaultStateDir(),
      clientName: "sdk",
      clientVersion: SDK_TRANSPORT_VERSION,
      requestTimeoutMs: REQUEST_TIMEOUT_MS
    });
  } catch (error) {
    if (error instanceof RelayTransportError && error.code === "not_connected")
      return { state: null, device: null, connected: false };
    throw error;
  }
  try {
    return await statusOf2(wire);
  } finally {
    wire.close();
  }
};
export {
  CapabilityTokenMintError,
  CapabilityUnavailableError,
  MachineWireError,
  OUTPUT_CREDIT_BYTES,
  RelayTransportError,
  SDK_TRANSPORT_VERSION,
  createRelayTransport,
  relayStatus
};
