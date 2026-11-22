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
   this agreement changes that package's license. Notwithstanding anything else in this
   agreement, the compiled bunshin-ts and bunshin-ts-relay client libraries built from this
   software may be distributed with this agreement attached, as built or bundled into the build
   output of the omo-ai and omo-senpi packages, inside those packages and their source
   repositories; this permission covers only those copies and grants no other right.

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
  "signed_out",
  "fail_closed"
];
var STATUS_UPDATE_PHASES = ["trial", "committed"];
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
var COMMAND_ID_CHARS = 22;
var MACHINE_STATES = ["online", "offline", "unsupported"];
var MACHINE_LOOKUP_STATES = ["in_flight", "terminal", "unknown"];
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
  sign_in_reason;
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
    if (extra.sign_in_reason !== undefined)
      this.sign_in_reason = extra.sign_in_reason;
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
// packages/daemon/src/bytes-encoding.ts
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var portable = {
  hex: (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
  base64: (bytes) => {
    let out = "";
    for (let i = 0;i < bytes.length; i += 3) {
      const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
      const n = a << 16 | b << 8 | c;
      out += ALPHABET.charAt(n >> 18 & 63) + ALPHABET.charAt(n >> 12 & 63);
      out += i + 1 < bytes.length ? ALPHABET.charAt(n >> 6 & 63) : "=";
      out += i + 2 < bytes.length ? ALPHABET.charAt(n & 63) : "=";
    }
    return out;
  },
  fromBase64url: (text) => {
    if (!/^[A-Za-z0-9_-]*={0,2}$/.test(text))
      throw new SyntaxError("invalid base64url");
    const clean = text.replaceAll("-", "+").replaceAll("_", "/").replace(/=+$/, "");
    if (clean.length % 4 === 1)
      throw new SyntaxError("invalid base64url");
    const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
    let bits = 0;
    let value = 0;
    let at = 0;
    for (const ch of clean) {
      value = value << 6 | ALPHABET.indexOf(ch);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[at++] = value >> bits & 255;
      }
    }
    return out;
  }
};
var native = (bytes) => bytes;
var from = Uint8Array;
var toBase64 = (bytes) => native(bytes).toBase64?.() ?? portable.base64(bytes);
var toBase64url = (bytes) => native(bytes).toBase64?.({ alphabet: "base64url", omitPadding: true }) ?? portable.base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
var fromBase64url = (text) => from.fromBase64?.(text, { alphabet: "base64url" }) ?? portable.fromBase64url(text);

// packages/local-api/src/limits.ts
import { createHash } from "node:crypto";

// packages/bunshin-ts-relay/src/spec-proto.ts
var SESSION_BLOB_MAX = 16777216;
var SESSION_DEVICE_MAX_CHARS = 64;
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

// packages/local-api/src/limits.ts
var LOCAL_INLINE_MAX = 524288;
var LOCAL_CHUNK_MAX = 262144;
var LOCAL_JSON_EXPANSION_MAX = 6;
var LOCAL_BLOB_MAX = LOCAL_JSON_EXPANSION_MAX * SESSION_BLOB_MAX;
var MACHINE_UPLOAD_MAX_BYTES = 3840000;
var MACHINE_UPLOAD_PARTS_MAX = Math.ceil(MACHINE_UPLOAD_MAX_BYTES / LOCAL_CHUNK_MAX);
var MACHINE_UPLOADS_OPEN_MAX = 4;
var grouped = (n) => n.toLocaleString("en-US");
var MACHINE_UPLOAD_LIMIT = `an uploaded batch is at most ${grouped(MACHINE_UPLOAD_MAX_BYTES)} bytes (${MACHINE_UPLOAD_PARTS_MAX} parts of ${grouped(LOCAL_CHUNK_MAX)} bytes)`;
var encoder2 = new TextEncoder;
var lineBytes = (value) => encoder2.encode(JSON.stringify(value)).length + 1;
var sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
var chunkPayload = (data) => {
  const chunks = [];
  for (let off = 0;off < data.length; off += LOCAL_CHUNK_MAX)
    chunks.push({
      off,
      b: toBase64(data.subarray(off, off + LOCAL_CHUNK_MAX))
    });
  return chunks;
};

// packages/local-api/src/validate-fields.ts
import { posix, win32 } from "node:path";
var LOCAL_ID_MAX_CHARS = 64;
var PATH_MAX_CHARS = 4096;
var LABEL_MAX_CHARS = 256;
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
var known = (v, required, optional = [], what = "message") => {
  if (!isRecord(v))
    return fail2(`${what} must be an object`);
  const out = {};
  for (const name of required) {
    if (!Object.hasOwn(v, name))
      fail2(`${what} misses ${name}`);
    out[name] = v[name];
  }
  for (const name of optional)
    if (Object.hasOwn(v, name))
      out[name] = v[name];
  return out;
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
var nullable = (v, check) => v === null ? null : check(v);
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

// packages/local-api/src/protocol-status.ts
var SIGN_IN_REASONS = ["not_adopted", "device_revoked", "reauth_required"];

// packages/local-api/src/validate-session-answer.ts
var refOf = (v, what) => {
  const m = known(v, ["device", "key", "session"], [], what);
  const ref = parseSessionRef(m["session"]);
  if (ref === undefined || ref.device !== m["device"] || ref.key !== m["key"])
    return fail2(what);
  return { device: ref.device, key: ref.key, session: formatSessionRef(ref) };
};
var commandAnswerOf = (v) => {
  const m = known(v, ["command_id"], ["device", "key", "session"], "session.command data");
  const command_id = commandId(m["command_id"]);
  if (m["device"] === undefined && m["key"] === undefined && m["session"] === undefined)
    return { command_id };
  const { device, key, session } = m;
  return { command_id, ...refOf({ device, key, session }, "session.command data") };
};

// packages/local-api/src/validate-update.ts
var READY_REASON_MAX_CHARS = 64;
var statusUpdateOf = (v) => {
  const m = known(v, ["update_id", "phase", "target_version", "ready", "ready_reason"], [], "status.update");
  return {
    update_id: localId(m["update_id"], "status.update.update_id"),
    phase: oneOf(STATUS_UPDATE_PHASES, m["phase"], "status.update.phase"),
    target_version: semver(m["target_version"], "status.update.target_version"),
    ready: bool(m["ready"], "status.update.ready"),
    ready_reason: nullable(m["ready_reason"], (r) => text(r, READY_REASON_MAX_CHARS, "status.update.ready_reason"))
  };
};

// packages/local-api/src/validate-shapes.ts
var CODE = /^[a-z_]{1,64}$/;
var MILLIS_MAX = Number.MAX_SAFE_INTEGER;
var deviceId = (v, what = "device") => text(v, SESSION_DEVICE_MAX_CHARS, what);
var millis = (v, what) => uint(v, 0, MILLIS_MAX, what);
var deviceRef = (v, what = "device", fields = exactly) => {
  const m = fields(v, ["id", "name"], [], what);
  return {
    id: deviceId(m["id"], `${what}.id`),
    name: text(m["name"], LABEL_MAX_CHARS, `${what}.name`)
  };
};
var policyOf = (v) => {
  const m = known(v, ["state", "generation", "this_device", "homes_pending", "unacked"], [], "policy");
  const unacked = m["unacked"];
  if (!Array.isArray(unacked))
    return fail2("policy.unacked");
  return {
    state: oneOf(POLICY_STATES, m["state"], "policy.state"),
    generation: millis(m["generation"], "policy.generation"),
    this_device: oneOf(THIS_DEVICE_STATES, m["this_device"], "policy.this_device"),
    homes_pending: millis(m["homes_pending"], "policy.homes_pending"),
    unacked: unacked.map((u) => {
      const entry = known(u, ["device", "label"], [], "policy.unacked");
      return {
        device: deviceId(entry["device"]),
        label: text(entry["label"], LABEL_MAX_CHARS, "label", 0)
      };
    })
  };
};
var statusOf = (v) => {
  const m = known(v, ["state", "since_ms", "device", "origin_configured", "enabled"], ["detail", "policy", "update", "exe"], "status");
  const { detail, policy, update, exe } = m;
  return {
    state: oneOf(STATUS_STATES, m["state"], "status.state"),
    since_ms: millis(m["since_ms"], "status.since_ms"),
    ...detail === undefined ? {} : { detail: detailOf(detail) },
    device: nullable(m["device"], (d) => deviceRef(d, "status.device", known)),
    origin_configured: bool(m["origin_configured"], "status.origin_configured"),
    enabled: bool(m["enabled"], "status.enabled"),
    ...policy === undefined ? {} : { policy: policyOf(policy) },
    ...update === undefined ? {} : { update: statusUpdateOf(update) },
    ...exe === undefined ? {} : { exe: absolutePath(exe, "status.exe") }
  };
};
var detailOf = (v) => {
  const m = known(v, ["code", "action"], ["sign_in_reason"], "status.detail");
  const { code, sign_in_reason: reason } = m;
  return {
    code: typeof code === "string" && CODE.test(code) ? code : fail2("status.detail.code"),
    action: nullable(m["action"], (a) => text(a, LABEL_MAX_CHARS, "status.detail.action")),
    ...reason === undefined ? {} : { sign_in_reason: oneOf(SIGN_IN_REASONS, reason, "status.detail.sign_in_reason") }
  };
};
var deviceRowOf = (v) => {
  const m = known(v, ["device", "label", "kind", "platform", "last_seen_ms", "online"], ["managed"], "device row");
  const managed = m["managed"];
  return {
    device: deviceId(m["device"]),
    label: text(m["label"], LABEL_MAX_CHARS, "label", 0),
    kind: text(m["kind"], 64, "kind", 0),
    platform: text(m["platform"], 64, "platform", 0),
    last_seen_ms: nullable(m["last_seen_ms"], (t) => millis(t, "last_seen_ms")),
    online: bool(m["online"], "online"),
    ...managed === undefined ? {} : { managed: bool(managed, "managed") }
  };
};

// packages/local-api/src/validate-delegated.ts
var ENDPOINT_KEY = /^[A-Za-z0-9_-]{22}$/;
var ENDPOINTS_MAX = 16;
var ENVIRONMENTS_MAX = 4;
var endpointKey = (v, what = "endpoint") => typeof v === "string" && ENDPOINT_KEY.test(v) ? v : fail2(what);
var keysOf = (v, max, what) => {
  if (!Array.isArray(v) || v.length > max)
    return fail2(what);
  const keys = v.map((e) => endpointKey(e, what));
  return new Set(keys).size === keys.length ? keys : fail2(what);
};
var endpointsData = (v) => {
  const m = known(v, ["endpoints"], ["environments", "primary"], "data");
  const endpoints = keysOf(m["endpoints"], ENDPOINTS_MAX, "endpoints");
  const primary = m["primary"] === undefined ? undefined : endpointKey(m["primary"], "primary");
  if (primary !== undefined && !endpoints.includes(primary))
    return fail2("primary");
  return {
    endpoints,
    ...m["environments"] === undefined ? {} : { environments: keysOf(m["environments"], ENVIRONMENTS_MAX, "environments") },
    ...primary === undefined ? {} : { primary }
  };
};
var endpointsListData = (m) => {
  const dirs = m["agent_dirs"];
  if (!Array.isArray(dirs))
    return fail2("agent_dirs");
  return { agent_dirs: dirs.map((d) => absolutePath(d, "agent_dirs")) };
};

// packages/local-api/src/validate-machine.ts
var BASE64URL2 = /^[A-Za-z0-9_-]+$/;
var machineId = (v, what) => typeof v === "string" && v.length === COMMAND_ID_CHARS && BASE64URL2.test(v) ? v : fail2(what);
var empty = (v) => {
  known(v, [], [], "data");
  return {};
};
var fields = (v, names) => known(v, names, [], "data");
var LEGACY_MACHINE_ROUTE_KINDS = ["internet", "lan"];
var legacyRouteOf = (v) => {
  const r = known(v, ["kind", "online"], [], "machine route");
  const kind = oneOf(LEGACY_MACHINE_ROUTE_KINDS, r["kind"], "machine route kind");
  bool(r["online"], "online");
  return kind;
};
var machineRowOf = (v) => {
  const m = known(v, ["device", "label", "state"], ["routes"], "machine row");
  const routes = m["routes"];
  if (routes !== undefined && (!Array.isArray(routes) || routes.length > LEGACY_MACHINE_ROUTE_KINDS.length))
    return fail2("routes");
  const listed = routes?.map(legacyRouteOf);
  if (listed !== undefined && new Set(listed).size !== listed.length)
    return fail2("routes");
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
    received: uint(fields(v, ["received"])["received"], 0, MACHINE_UPLOAD_PARTS_MAX - 1, "received")
  }),
  "machine.cancel": empty,
  "machine.credit": empty,
  "machine.result_of": (v) => ({
    state: oneOf(MACHINE_LOOKUP_STATES, fields(v, ["state"])["state"], "lookup state")
  }),
  "machine.events.subscribe": empty
};

// packages/local-api/src/validate-deliveries.ts
var empty2 = (v) => {
  known(v, [], [], "data");
  return {};
};
var DELIVERIES_DATA = {
  "deliveries.serve": (v) => {
    const m = known(v, ["wake"], [], "data");
    return { wake: bool(m["wake"], "wake") };
  },
  "delivery.answer": empty2,
  "delivery.held": empty2,
  "delivery.pending": empty2,
  "delivery.drained": (v) => {
    const m = known(v, ["kept"], ["expecting"], "data");
    const kept = bool(m["kept"], "kept");
    if (!kept)
      return m["expecting"] === undefined ? { kept } : fail2("expecting");
    return { kept, expecting: commandId(m["expecting"]) };
  },
  "peer.admitted": (v) => ({
    admitted: bool(known(v, ["admitted"], [], "data")["admitted"], "admitted")
  })
};

// packages/local-api/src/validate-session-wake.ts
var storedOf = (v) => v === null || v === "unreadable" || typeof v === "boolean" ? v : fail2("stored");
var sessionWakeState = (v) => {
  const m = known(v, ["enabled", "stored", "changedAt", "overridden"], [], "data");
  const stored = m["stored"];
  const changedAt = m["changedAt"];
  return {
    enabled: bool(m["enabled"], "enabled"),
    stored: storedOf(stored),
    changedAt: typeof changedAt === "string" ? changedAt : fail2("changedAt"),
    overridden: bool(m["overridden"], "overridden")
  };
};

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
    const m = known(v, ["type", "reason"], [], "refused");
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
  const m = known(v, fields, [], "welcome");
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
var empty3 = (v) => {
  known(v, [], [], "data");
  return {};
};
var one = (v, name) => known(v, [name], [], "data")[name];
var attachState = (v) => {
  const m = known(v, ["attached", "changedAt"], [], "data");
  const changedAt = m["changedAt"];
  return {
    attached: bool(m["attached"], "attached"),
    changedAt: typeof changedAt === "string" ? changedAt : fail2("changedAt")
  };
};
var remoteCommandsState = (v) => {
  const m = known(v, ["enabled", "changedAt", "overridden"], [], "data");
  const changedAt = m["changedAt"];
  return {
    enabled: bool(m["enabled"], "enabled"),
    changedAt: typeof changedAt === "string" ? changedAt : fail2("changedAt"),
    overridden: bool(m["overridden"], "overridden")
  };
};
var DATA = {
  authenticate: empty3,
  "status.get": statusOf,
  "status.subscribe": empty3,
  "service.set_enabled": (v) => ({ enabled: bool(one(v, "enabled"), "enabled") }),
  "refresher.register": empty3,
  "device.adopt": (v) => ({ device: deviceRef(one(v, "device"), "device", known) }),
  "device.forget": empty3,
  "device.info": (v) => ({
    device: nullable(one(v, "device"), (d) => deviceRef(d, "device", known))
  }),
  "endpoints.register": empty3,
  "endpoints.unregister": empty3,
  "endpoints.list": (v) => endpointsListData(known(v, ["agent_dirs"], [], "data")),
  "session.presenter_open": empty3,
  "session.presenter_send": empty3,
  "devices.list": (v) => {
    const devices = one(v, "devices");
    return Array.isArray(devices) ? { devices: devices.map(deviceRowOf) } : fail2("devices");
  },
  "sessions.list": (v) => ({ query_id: localId(one(v, "query_id"), "query_id") }),
  "sessions.events.subscribe": empty3,
  "session.attach": (v) => ({ attach: localId(one(v, "attach"), "attach") }),
  "session.detach": empty3,
  "session.command": commandAnswerOf,
  "session.command_part": (v) => ({
    received: uint(one(v, "received"), 0, LOCAL_UPLOAD_PARTS_MAX - 1, "received")
  }),
  "session.read": (v) => ({ query_id: localId(one(v, "query_id"), "query_id") }),
  "enforcement.report": empty3,
  "owner.shutdown_for_upgrade": empty3,
  "owner.update_committed": empty3,
  "control.attach.get": attachState,
  "control.attach.set": attachState,
  "control.remote_commands.get": remoteCommandsState,
  "control.remote_commands.set": remoteCommandsState,
  "control.session_wake.get": sessionWakeState,
  "control.session_wake.set": sessionWakeState,
  "session.endpoints": endpointsData,
  "session.locate": (v) => refOf(v, "session.locate data"),
  ...MACHINE_DATA,
  ...DELIVERIES_DATA
};
// packages/local-api/src/proof.ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
var NONCE_BYTES = 32;
var mintNonce = () => toBase64url(randomBytes(NONCE_BYTES));
var mintId = () => toBase64url(randomBytes(16));
var decodedBytes = (value, bytes, what) => {
  const violation = () => new LocalApiError("protocol_violation", `${what} is not ${bytes} base64url bytes`);
  let out;
  try {
    out = fromBase64url(value);
  } catch (error) {
    if (error instanceof Error)
      throw violation();
    throw error;
  }
  if (out.length !== bytes || toBase64url(out) !== value)
    throw violation();
  return out;
};
var proof = (token, label, nonce, endpoint) => toBase64url(createHmac("sha256", token).update(label).update(decodedBytes(nonce, NONCE_BYTES, "a nonce")).update(endpoint).digest());
var serverProof = (token, clientNonce, endpoint) => proof(token, "server", clientNonce, endpoint);
var clientProof = (token, serverNonce, endpoint) => proof(token, "client", serverNonce, endpoint);
var proofMatches = (expected, actual) => {
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(actual);
  return a.length === b.length && timingSafeEqual(a, b);
};
// packages/local-api/src/access.ts
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
var TOKEN_FILE = "token";
var TOKEN_BYTES = 32;
var SOCKET_FILE = "service.sock";
var insecure = (detail) => {
  throw new LocalApiError("insecure_state_dir", detail);
};
var UNIX_ENDPOINT = "unix";
var tcpEndpoint = (port) => `tcp:${port}`;
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
    return decodedBytes(value, TOKEN_BYTES, "the token");
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
  "signed_out",
  "fail_closed"
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

// packages/local-api/src/state-dir.ts
import { readFileSync as readFileSync3, statSync } from "node:fs";
import { join as join3, posix as posix2, win32 as win322 } from "node:path";
var STATE_DIR_ENV = "OMO_DEVICE_SERVICE_STATE_DIR";
var isAbsoluteOn = (platform, path) => (platform === "win32" ? win322 : posix2).isAbsolute(path);
var defaultStateDir = (platform, home, env) => platform === "win32" ? join3(env["LOCALAPPDATA"] ?? join3(home, "AppData", "Local"), "OmO", "device-service") : join3(home, ".omo", "device-service");
var locationFile = (platform, home, env) => `${defaultStateDir(platform, home, env)}.location.json`;
var locatedStateDir = (platform, file) => {
  try {
    const parsed = JSON.parse(readFileSync3(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null)
      return;
    const v = Reflect.get(parsed, "v");
    const dir = Reflect.get(parsed, "state_dir");
    return v === 1 && typeof dir === "string" && isAbsoluteOn(platform, dir) ? dir : undefined;
  } catch {
    return;
  }
};
var isDirectory = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};
var resolveStateDir = (platform, home, env) => {
  const explicit = env[STATE_DIR_ENV];
  if (explicit !== undefined && explicit !== "" && isAbsoluteOn(platform, explicit))
    return explicit;
  const located = locatedStateDir(platform, locationFile(platform, home, env));
  return located !== undefined && isDirectory(located) ? located : defaultStateDir(platform, home, env);
};

// packages/bunshin-ts-relay/src/env.ts
var SESSION_REF_ENV = "PI_SESSION_ID";
var SESSION_REF_MAX_CHARS = 128;
var serviceStateDir = (env = process.env, home = homedir(), platform = process.platform) => resolveStateDir(platform, home, env);
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

// packages/bunshin-ts-relay/src/token-grant.ts
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var canonical = (value) => JSON.stringify(value, (_key, v) => isRecord2(v) ? Object.fromEntries(Object.entries(v).toSorted(([a], [b]) => a < b ? -1 : 1)) : v);
var admits = (constraint, value) => {
  if (!isRecord2(constraint))
    return false;
  switch (constraint["kind"]) {
    case "any":
      return true;
    case "exact":
      return Object.hasOwn(constraint, "value") && canonical(value) === canonical(constraint["value"]);
    case "oneOf": {
      const values = constraint["values"];
      return Array.isArray(values) && values.some((v) => canonical(v) === canonical(value));
    }
    case "prefix": {
      const prefix = constraint["prefix"];
      return typeof value === "string" && typeof prefix === "string" && value.startsWith(prefix);
    }
    case "range": {
      const { min, max } = constraint;
      return typeof value === "number" && typeof min === "number" && typeof max === "number" && value >= min && value <= max;
    }
    default:
      return false;
  }
};
var violation = (message) => {
  throw new MachineWireError("constraint_violation", message);
};
var assertGrantCovers = (claims, args, taskId) => {
  const granted = claims["taskId"];
  if (granted !== undefined && granted !== taskId)
    violation("the token was minted for another task");
  const argConstraints = claims["argConstraints"];
  if (argConstraints === undefined)
    return;
  if (!isRecord2(argConstraints))
    return violation("the token's argConstraints are not an object");
  for (const [field, constraint] of Object.entries(argConstraints)) {
    if (!isRecord2(args) || !Object.hasOwn(args, field))
      violation(`the token constrains ${field}, which the op does not carry`);
    else if (!admits(constraint, args[field]))
      violation(`${field} is outside the token's grant`);
  }
};

// packages/bunshin-ts-relay/src/capability-token.ts
var DEFAULT_TOKEN_TTL_MS = 15 * 60000;
var CLAIM_KEYS = new Set([
  "machineId",
  "allowedOps",
  "pathJail",
  "argConstraints",
  "taskId",
  "exp",
  "nbf"
]);
var malformed = (message) => {
  throw new CapabilityTokenMintError(400, "malformed_input", message);
};
var nonEmpty = (value) => typeof value === "string" && value !== "";
var isRecord3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var mintCapabilityToken = (input, now = Date.now()) => {
  if (!nonEmpty(input.machineId))
    return malformed("machineId must be a non-empty string");
  if (!Array.isArray(input.allowedOps) || input.allowedOps.length === 0)
    return malformed("allowedOps must name at least one op");
  if (!input.allowedOps.every(nonEmpty))
    return malformed("every allowed op must be a non-empty string");
  if (!nonEmpty(input.pathJail))
    return malformed("pathJail must be a non-empty string");
  if (input.argConstraints !== undefined && !isRecord3(input.argConstraints))
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
var constraintsOf = (token, machineId, args, taskId) => {
  let claims;
  try {
    claims = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch (error) {
    throw new CapabilityTokenMintError(400, "malformed_token", "the token is not base64url JSON", {
      cause: error
    });
  }
  if (!isRecord3(claims) || !nonEmpty(claims["machineId"]) || !Array.isArray(claims["allowedOps"]))
    throw new CapabilityTokenMintError(400, "malformed_token", "the token carries no claims");
  const unknown = Object.keys(claims).filter((key) => !CLAIM_KEYS.has(key));
  if (unknown.length > 0)
    throw new CapabilityTokenMintError(400, "malformed_token", `the token carries claims this sender cannot enforce: ${unknown.join(", ")}`);
  if (claims["machineId"] !== machineId)
    throw new MachineWireError("constraint_violation", "the token targets another machine");
  const nbf = claims["nbf"];
  if (typeof nbf !== "number" || !Number.isFinite(nbf))
    throw new CapabilityTokenMintError(400, "malformed_token", "the token has no finite nbf");
  if (nbf > Date.now())
    throw new MachineWireError("constraint_violation", "the token is not active yet");
  assertGrantCovers(claims, args, taskId);
  const { allowedOps, pathJail, exp } = claims;
  const services = servicesOf(allowedOps, claims["argConstraints"]);
  return { allowedOps, pathJail, exp, ...services === undefined ? {} : { services } };
};
var servicesOf = (allowedOps, argConstraints) => {
  if (!Array.isArray(allowedOps) || !allowedOps.includes("service.restart"))
    return;
  const name = isRecord3(argConstraints) ? argConstraints["name"] : undefined;
  if (!isRecord3(name))
    return;
  if (name["kind"] === "exact" && typeof name["value"] === "string")
    return [name["value"]];
  const values = name["values"];
  return name["kind"] === "oneOf" && Array.isArray(values) && values.every((v) => typeof v === "string") ? values : undefined;
};
var tokenAllows = (token, machineId, op, args, taskId) => {
  try {
    const { allowedOps } = constraintsOf(token, machineId, args, taskId);
    return Array.isArray(allowedOps) && allowedOps.includes(op);
  } catch {
    return false;
  }
};

// packages/bunshin-ts-relay/src/op-fields.ts
import { createHash as createHash2 } from "node:crypto";
var mintOpId = () => mintId();
var OP_ID = /^[A-Za-z0-9_-]{22}$/;
var wireOpIdOf = (opId) => OP_ID.test(opId) ? opId : createHash2("sha256").update(opId).digest().subarray(0, 16).toString("base64url");
var isRecord4 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var violation2 = (detail) => {
  throw new LocalApiError("protocol_violation", detail);
};
var text2 = (event, name) => {
  const value = event[name];
  return typeof value === "string" ? value : violation2(`${event.kind} without ${name}`);
};
var entryOf = (value) => {
  if (!isRecord4(value) || typeof value["state"] !== "string")
    return violation2("an op result without a state");
  const error = value["error"];
  const code = isRecord4(error) ? error["code"] : undefined;
  if (error !== undefined && typeof code !== "string")
    return violation2("an op error without a code");
  const message = isRecord4(error) ? String(error["message"] ?? code) : "";
  const uncertain = isRecord4(error) && error["uncertain"] === true ? { uncertain: true } : {};
  return {
    state: value["state"],
    ..."response" in value ? { response: value["response"] } : {},
    ...typeof code === "string" ? { error: { code, message, ...uncertain } } : {}
  };
};
var argsOf = (args) => {
  if (args === undefined)
    return {};
  const plain = JSON.parse(JSON.stringify(args));
  if (!isRecord4(plain))
    throw new TypeError("machine op args must be a JSON object");
  return plain;
};
var abortError = (signal) => signal.reason instanceof Error ? signal.reason : new DOMException("the operation was aborted", "AbortError");

// packages/bunshin-ts-relay/src/chunked-read.ts
var CHUNKED_READ_MAX_BYTES = 256 * 1024 * 1024;
var wholeReadPath = (capability, args) => capability === "fs.read" && isRecord4(args) && typeof args["path"] === "string" && args["offset"] === undefined && args["limit_bytes"] === undefined ? args["path"] : undefined;
var isLimitExceeded = (error) => error instanceof MachineWireError && error.code === "limit_exceeded";
var changed = (path, detail) => {
  throw new MachineWireError("file_changed", `${path} changed while it was read in chunks: ${detail}`);
};
var versionOf = (path, reply) => {
  const size = isRecord4(reply) ? reply["size"] : undefined;
  const mtimeMs = isRecord4(reply) ? reply["mtimeMs"] : undefined;
  return typeof size === "number" && typeof mtimeMs === "number" ? { size, mtimeMs } : violation2(`fs.stat of ${path} answered without a numeric size and mtimeMs`);
};
var isStatRefusal = (error) => error instanceof CapabilityUnavailableError || error instanceof MachineWireError && (error.code === "op_unknown" || error.code.startsWith("capability_") || error.code.startsWith("constraint_"));
var chunkOf = (path, reply, offset, chunkBytes, size) => {
  const bytes = isRecord4(reply) ? reply["bytes"] : undefined;
  const replySize = isRecord4(reply) ? reply["size"] : undefined;
  if (!isRecord4(reply) || typeof bytes !== "string" || typeof replySize !== "number")
    return violation2("an fs.read chunk reply without base64 bytes and a numeric size");
  if (replySize !== size)
    return changed(path, `its size went from ${size} to ${replySize} bytes`);
  if (reply["offset"] !== offset)
    return violation2(`an fs.read chunk reply at offset ${String(reply["offset"])}, asked for ${offset}`);
  const part = Buffer.from(bytes, "base64");
  if (part.length > chunkBytes || offset + part.length > size)
    return violation2(`an fs.read chunk reply of ${part.length} bytes at offset ${offset}, above the ${chunkBytes}-byte chunk or the ${size}-byte size`);
  if (part.length === 0)
    return changed(path, `it ended at ${offset} of ${size} bytes`);
  return { part, path: reply["path"] };
};
var capped = (path, size, chunkBytes) => {
  throw new MachineWireError("limit_exceeded", `${path} is ${size} bytes, above the ${CHUNKED_READ_MAX_BYTES}-byte cap of an automatic chunked read; read it in chunks with fs.read {path, offset, limit_bytes}, limit_bytes at most ${chunkBytes}`);
};
var readInChunks = async (path, chunkBytes, ops, refusal) => {
  const before = versionOf(path, await ops.stat().catch((error) => {
    throw isStatRefusal(error) ? refusal : error;
  }));
  if (before.size > CHUNKED_READ_MAX_BYTES)
    return capped(path, before.size, chunkBytes);
  const parts = [];
  let offset = 0;
  let resolved = path;
  while (offset < before.size) {
    const reply = await ops.read({ path, offset, limit_bytes: chunkBytes });
    const chunk = chunkOf(path, reply, offset, chunkBytes, before.size);
    resolved = chunk.path;
    parts.push(chunk.part);
    offset += chunk.part.length;
  }
  const after = versionOf(path, await ops.stat());
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
    return changed(path, `fs.stat went from ${before.size} bytes at ${before.mtimeMs} ms to ${after.size} bytes at ${after.mtimeMs} ms`);
  return {
    path: resolved,
    bytes: Buffer.concat(parts).toString("base64"),
    size: before.size,
    offset: 0
  };
};

// packages/bunshin-ts-relay/src/tree-apply.ts
import { isAbsolute as isAbsolute2 } from "node:path";

// packages/bunshin-ts-relay/src/tree-archive.ts
import { createHash as createHash3 } from "node:crypto";
import { isAbsolute } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
var BLOCK = 512;
var TYPE_CODES = { file: "0", dir: "5", symlink: "2" };
var FIELDS = {
  name: [0, 100],
  mode: [100, 8],
  uid: [108, 8],
  gid: [116, 8],
  size: [124, 12],
  mtime: [136, 12],
  checksum: [148, 8],
  typeflag: [156, 1],
  linkname: [157, 100],
  magic: [257, 6],
  version: [263, 2],
  uname: [265, 32],
  gname: [297, 32]
};
var malformed2 = (detail) => {
  throw new MachineWireError("malformed_input", `malformed_input: ${detail}`);
};
var escape = (detail) => {
  throw new MachineWireError("path_escape", `path_escape: ${detail}`);
};
var linkTargetStaysInside = (entryName, link) => {
  if (isAbsolute(link) || /^[\\/]/.test(link) || /^[A-Za-z]:[\\/]/.test(link))
    return false;
  let depth = entryName.split(/[\\/]/).filter(Boolean).length - 1;
  for (const part of link.split(/[\\/]/)) {
    if (part === "" || part === ".")
      continue;
    depth += part === ".." ? -1 : 1;
    if (depth < 0)
      return false;
  }
  return true;
};
var octal = (value, length) => `${value.toString(8).padStart(length - 1, "0")}\x00`.slice(-length);
var put = (block, field, value) => {
  const [offset, length] = FIELDS[field];
  block.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8");
};
var bytesOf = (block, field) => {
  const [offset, length] = FIELDS[field];
  return block.subarray(offset, offset + length);
};
var stringOf = (value) => value.toString("utf8").replace(/\0.*$/s, "");
var numberOf = (value) => Number.parseInt(stringOf(value).trim() || "0", 8);
var header = (name, mode, size, type, link = "") => {
  const h = Buffer.alloc(BLOCK);
  put(h, "name", name);
  put(h, "mode", octal(mode & 4095, 8));
  put(h, "uid", octal(0, 8));
  put(h, "gid", octal(0, 8));
  put(h, "size", octal(size, 12));
  put(h, "mtime", octal(0, 12));
  h.fill(32, 148, 156);
  put(h, "typeflag", type);
  put(h, "linkname", link);
  put(h, "magic", "ustar\x00");
  put(h, "version", "00");
  put(h, "uname", "root");
  put(h, "gname", "root");
  let sum = 0;
  for (const byte of h)
    sum += byte;
  put(h, "checksum", octal(sum, 8));
  return h;
};
var padded = (bytes) => Buffer.concat([bytes, Buffer.alloc((BLOCK - bytes.length % BLOCK) % BLOCK)]);
var paxRecord = (key, value) => {
  const raw = `${key}=${value}
`;
  let length = Buffer.byteLength(raw) + String(Buffer.byteLength(raw)).length + 1;
  while (length !== Buffer.byteLength(`${length} ${raw}`))
    length = Buffer.byteLength(`${length} ${raw}`);
  return Buffer.from(`${length} ${raw}`);
};
var archiveName = (entry) => entry.kind === "dir" ? `${entry.path}/` : entry.path;
var entryBlocks = (entry) => {
  const name = archiveName(entry);
  const data = entry.data ?? new Uint8Array(0);
  const longName = Buffer.byteLength(name) > 100;
  const longLink = entry.link !== undefined && Buffer.byteLength(entry.link) > 100;
  const type = TYPE_CODES[entry.kind];
  const body = [
    header(longName ? "" : name, entry.mode, data.length, type, longLink ? "" : entry.link),
    padded(data)
  ];
  if (!longName && !longLink)
    return body;
  const pax = Buffer.concat([
    longName ? paxRecord("path", name) : Buffer.alloc(0),
    longLink ? paxRecord("linkpath", entry.link ?? "") : Buffer.alloc(0)
  ]);
  const paxName = `PaxHeaders/${createHash3("sha256").update(name).digest("hex").slice(0, 16)}`;
  return [header(paxName, 420, pax.length, "x"), padded(pax), ...body];
};
var packTreeEntries = (entries) => {
  const sorted = [...entries].sort((a, b) => archiveName(a).localeCompare(archiveName(b)));
  return gzipSync(Buffer.concat([...sorted.flatMap(entryBlocks), Buffer.alloc(BLOCK * 2)]), {
    level: 9
  });
};
var ancestorsOf = (path) => path.split("/").slice(0, -1).map((_, at, parts) => parts.slice(0, at + 1).join("/"));
var checkShape = (entries) => {
  const seen = new Set;
  const links = new Set(entries.filter((e) => e.kind === "symlink").map((e) => e.path));
  for (const entry of entries) {
    if (seen.has(entry.path))
      malformed2(`${entry.path} is listed twice`);
    seen.add(entry.path);
    if (ancestorsOf(entry.path).some((parent) => links.has(parent)))
      escape(`${entry.path} is under a symlink member`);
  }
  return entries;
};
var relativeName = (raw) => raw.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
var readTreeEntries = (archive) => {
  let bytes;
  try {
    bytes = gunzipSync(archive);
  } catch {
    return malformed2("invalid gzip");
  }
  const entries = [];
  const long = {};
  for (let offset = 0;offset + BLOCK <= bytes.length; ) {
    const h = bytes.subarray(offset, offset + BLOCK);
    offset += BLOCK;
    if (h.every((v) => v === 0))
      break;
    const size = numberOf(bytesOf(h, "size"));
    const type = String.fromCharCode(h[156] ?? 0);
    const body = bytes.subarray(offset, offset + size);
    if (body.length !== size)
      return malformed2("a member runs past the archive");
    offset += Math.ceil(size / BLOCK) * BLOCK;
    if (type === "x") {
      const text = body.toString();
      const path = /(?:^|\n)\d+ path=([^\n]+)\n/.exec(text)?.[1];
      const link = /(?:^|\n)\d+ linkpath=([^\n]+)\n/.exec(text)?.[1];
      if (path === undefined && link === undefined)
        return malformed2("invalid pax header");
      if (path !== undefined)
        long.path = path;
      if (link !== undefined)
        long.link = link;
      continue;
    }
    if (type === "L" || type === "K") {
      long[type === "L" ? "path" : "link"] = stringOf(body);
      continue;
    }
    const raw = long.path ?? stringOf(bytesOf(h, "name"));
    const link = long.link ?? stringOf(bytesOf(h, "linkname"));
    delete long.path;
    delete long.link;
    const path = relativeName(raw);
    if (path === "" || path === ".")
      continue;
    if (isAbsolute(raw) || path.split(/[\\/]/).includes(".."))
      return escape(raw);
    const mode = numberOf(bytesOf(h, "mode")) & 4095;
    if (type === "5")
      entries.push({ path, kind: "dir", mode });
    else if (type === "2") {
      if (!linkTargetStaysInside(path, link))
        return escape(`${path} -> ${link}`);
      entries.push({ path, kind: "symlink", mode, link });
    } else if (type === "0" || type === "\x00")
      entries.push({ path, kind: "file", mode, data: new Uint8Array(body) });
    else
      return malformed2(`unsupported tar type ${type}`);
  }
  return checkShape(entries);
};

// packages/bunshin-ts-relay/src/tree-shell.ts
import { createHash as createHash4 } from "node:crypto";
var PATHS_PER_COMMAND = 200;
var quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;
var joinPath = (root, path) => path === "" ? root : `${root.replace(/\/+$/, "")}/${path}`;
var runShell = async (send, command, step) => {
  const reply = await send("shell", { command, cwd: "." });
  const exitCode = isRecord4(reply) ? reply["exitCode"] : undefined;
  const stdout = isRecord4(reply) ? reply["stdout"] : undefined;
  if (exitCode !== 0 || typeof stdout !== "string") {
    const stderr = isRecord4(reply) && typeof reply["stderr"] === "string" ? reply["stderr"] : "";
    throw new MachineWireError("tree_step_failed", `${step} failed on the device (exit ${String(exitCode)}): ${stderr.trim().slice(0, 500)}`);
  }
  if (isRecord4(reply) && reply["truncated"] === true)
    throw new MachineWireError("tree_step_failed", `${step}: the device cut the command's output`);
  return stdout;
};
var chunksOf = (items, size = PATHS_PER_COMMAND) => {
  const chunks = [];
  for (let at = 0;at < items.length; at += size)
    chunks.push(items.slice(at, at + size));
  return chunks;
};
var pool = async (items, limit, work) => {
  let next = 0;
  let failed = false;
  const lane = async () => {
    while (!failed && next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined)
        await work(item).catch((error) => {
          failed = true;
          throw error;
        });
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
};
var sha256Hex2 = (bytes) => createHash4("sha256").update(bytes).digest("hex");
var HASH_COMMAND = 'if command -v sha256sum >/dev/null 2>&1; then H="sha256sum"; else H="shasum -a 256"; fi; $H --';
var remoteDigests = async (send, root, paths) => {
  const digests = [];
  for (const chunk of chunksOf(paths)) {
    const out = await runShell(send, `cd -- ${quote(root)} && ${HASH_COMMAND} ${chunk.map(quote).join(" ")}`, "hashing the tree's files");
    for (const line of out.split(`
`).filter((l) => l !== "")) {
      const digest = /^\\?([0-9a-f]{64})\s/.exec(line)?.[1];
      if (digest === undefined)
        throw new MachineWireError("tree_step_failed", `unreadable hash line: ${line}`);
      digests.push(digest);
    }
  }
  if (digests.length !== paths.length)
    throw new MachineWireError("tree_step_failed", `hashed ${digests.length} of ${paths.length} files`);
  return digests;
};
var verifyFiles = async (send, root, files) => {
  const remote = await remoteDigests(send, root, files.map((file) => file.path));
  files.forEach((file, at) => {
    if (remote[at] !== sha256Hex2(file.data))
      throw new MachineWireError("verify_failed", `${joinPath(root, file.path)}: the device's sha256 differs from the bytes transferred`);
  });
  return files.length;
};

// packages/bunshin-ts-relay/src/tree-destination.ts
var clearDestinationLinks = async (send, root, entries) => {
  const dirMembers = new Set(entries.filter((e) => e.kind === "dir").map((e) => e.path));
  const parents = new Set(entries.flatMap((e) => ancestorsOf(e.path)));
  const targets = entries.filter((e) => e.kind !== "symlink").map((e) => e.path);
  const found = [];
  for (const chunk of chunksOf([...new Set([...parents, ...targets])])) {
    const out = await runShell(send, `[ -d ${quote(root)} ] || exit 0; cd -- ${quote(root)} && for p in ${chunk.map(quote).join(" ")}; do if [ -L "$p" ]; then printf '%s\\0' "$p"; fi; done`, "checking the destination for symlinks");
    found.push(...out.split("\x00").filter((path) => path !== ""));
  }
  const links = new Set(found);
  const outermost = found.filter((path) => !ancestorsOf(path).some((parent) => links.has(parent)));
  const escaping = outermost.find((path) => parents.has(path) && !dirMembers.has(path));
  if (escaping !== undefined)
    throw new MachineWireError("path_escape", `path_escape: ${joinPath(root, escaping)} is a symlink in the destination`);
  for (const chunk of chunksOf(outermost))
    await runShell(send, `rm -f -- ${chunk.map((path) => quote(joinPath(root, path))).join(" ")}`, "replacing the destination's symlinks");
};

// packages/bunshin-ts-relay/src/write-pieces.ts
import { posix as posix3 } from "node:path";
var WRITE_CHUNK_BYTES = 256 * 1024;
var SINGLE_WRITE_BASE64_MAX = LOCAL_INLINE_MAX - 32 * 1024;
var WRITE_KEYS = new Set(["path", "bytes", "create_parent_dirs"]);
var base64 = (bytes) => Buffer.from(bytes).toString("base64");
var writeInPieces = async (send, path, data, createParentDirs) => {
  const first = await send("fs.write", {
    path,
    bytes: base64(data.subarray(0, WRITE_CHUNK_BYTES)),
    create_parent_dirs: createParentDirs
  });
  for (let offset = WRITE_CHUNK_BYTES;offset < data.length; offset += WRITE_CHUNK_BYTES)
    await send("fs.write_range", {
      path,
      offset,
      bytes: base64(data.subarray(offset, offset + WRITE_CHUNK_BYTES)),
      total: data.length
    }).catch((error) => {
      if (!(error instanceof MachineWireError))
        throw error;
      throw new MachineWireError(error.code, `${error.message} (the write is incomplete: ${path} holds the new bytes up to ${offset}; the rest is missing or zero-filled)`);
    });
  return first;
};
var isPieceWrite = (capability, args) => {
  if (capability !== "fs.write" || !isRecord4(args))
    return false;
  const { path, bytes, create_parent_dirs: parents } = args;
  return Object.keys(args).every((key) => WRITE_KEYS.has(key)) && typeof path === "string" && path !== "" && typeof bytes === "string" && bytes.length > SINGLE_WRITE_BASE64_MAX && (parents === undefined || typeof parents === "boolean") && Buffer.from(bytes, "base64").toString("base64") === bytes;
};
var pieceWritePlan = (args, deviceOps, permits) => {
  const path = String(args["path"]);
  const range = { path, offset: 0, bytes: "", total: 0 };
  if (!deviceOps.includes("fs.write_range") || !permits("fs.write", args) || !permits("fs.write_range", range))
    return;
  return { verify: deviceOps.includes("shell") && permits("shell", { command: "true", cwd: "." }) };
};
var writeLarge = async (send, args, verify) => {
  const path = String(args["path"]);
  const data = Buffer.from(String(args["bytes"]), "base64");
  const first = await writeInPieces(send, path, data, args["create_parent_dirs"] === true);
  if (verify)
    await verifyFiles(send, posix3.dirname(path), [{ path: posix3.basename(path), data }]);
  const resolved = isRecord4(first) && typeof first["path"] === "string" ? first["path"] : path;
  return { path: resolved, writtenBytes: data.length };
};

// packages/bunshin-ts-relay/src/tree-apply.ts
var TREE_CONCURRENCY = 4;
var cleanDestination = async (send, root) => {
  if (!isAbsolute2(root) || root.split("/").filter(Boolean).length < 2)
    throw new MachineWireError("invalid_path", "invalid_path: clean destination is too shallow");
  await runShell(send, `mkdir -p -- ${quote(root)} && find ${quote(root)} -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +`, "emptying the destination");
};
var eachCommand = async (send, parts, separator, step) => {
  for (const chunk of chunksOf(parts))
    await runShell(send, chunk.join(separator), step);
};
var setModes = async (send, root, entries) => {
  const byMode = new Map;
  for (const entry of entries)
    byMode.set(entry.mode, [...byMode.get(entry.mode) ?? [], joinPath(root, entry.path)]);
  const commands = [...byMode].flatMap(([mode, paths]) => chunksOf(paths).map((chunk) => `chmod ${mode.toString(8)} -- ${chunk.map(quote).join(" ")}`));
  await eachCommand(send, commands, " && ", "setting the tree's modes");
};
var treePathArg = (args) => {
  const path = args["path"];
  if (typeof path !== "string" || path === "")
    throw new MachineWireError("invalid_argument", "fs.tree.* needs a non-empty path");
  if (args["format"] !== undefined && args["format"] !== "tar+gzip")
    throw new MachineWireError("invalid_argument", "fs.tree.* moves only the tar+gzip format");
  return path;
};
var applyTree = async (send, args, archive) => {
  const root = treePathArg(args);
  const entries = readTreeEntries(archive);
  const dirs = entries.filter((entry) => entry.kind === "dir");
  const links = entries.filter((entry) => entry.kind === "symlink");
  const files = entries.flatMap((entry) => entry.kind === "file" ? [{ ...entry, data: entry.data ?? new Uint8Array(0) }] : []);
  if (args["clean"] === true)
    await cleanDestination(send, root);
  await clearDestinationLinks(send, root, entries);
  const dirPaths = [root, ...dirs.map((dir) => joinPath(root, dir.path))];
  await eachCommand(send, chunksOf(dirPaths).map((chunk) => `mkdir -p -- ${chunk.map(quote).join(" ")}`), " && ", "making the tree's directories");
  await pool(files, TREE_CONCURRENCY, async (file) => {
    await writeInPieces(send, joinPath(root, file.path), file.data, true);
  });
  const linkCommands = links.map((link) => {
    const at = quote(joinPath(root, link.path));
    return `rm -f -- ${at} && ln -s -- ${quote(link.link ?? "")} ${at}`;
  });
  await setModes(send, root, [...dirs, ...files]);
  await eachCommand(send, linkCommands, " && ", "making the tree's symlinks");
  const verifiedFiles = await verifyFiles(send, root, files);
  return {
    fileCount: files.length,
    dirCount: dirs.length,
    symlinkCount: links.length,
    writtenBytes: files.reduce((sum, file) => sum + file.data.length, 0),
    verifiedFiles
  };
};

// packages/bunshin-ts-relay/src/tree-pack.ts
var DEFAULT_TREE_EXCLUDES = new Set([
  ".git",
  "node_modules",
  "target",
  ".DS_Store"
]);
var globs = (value) => Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
var listOf = async (send, path) => {
  const reply = await send("fs.list", { path });
  const entries = isRecord4(reply) ? reply["entries"] : undefined;
  if (!Array.isArray(entries))
    throw new MachineWireError("protocol_violation", `fs.list of ${path} answered no entries`);
  return entries.flatMap((e) => isRecord4(e) && typeof e["name"] === "string" && typeof e["type"] === "string" ? [{ name: e["name"], type: e["type"] }] : []).sort((a, b) => a.name.localeCompare(b.name));
};
var walk = async (send, root, args) => {
  const ignore = globs(args["ignore"]);
  const include = globs(args["include"]);
  const match = (pattern, path) => new Bun.Glob(pattern).match(path);
  const ignored = (path) => path.split("/").some((part) => DEFAULT_TREE_EXCLUDES.has(part)) || ignore.some((pattern) => match(pattern, path));
  const included = (path) => include.length === 0 || include.some((pattern) => match(pattern, path) || match(pattern, `${path}/`));
  const walked = { files: [], dirs: [], links: [] };
  let level = [
    { rel: "", conditional: false }
  ];
  while (level.length > 0) {
    const next = [];
    await pool(level, TREE_CONCURRENCY, async ({ rel, conditional }) => {
      const listed = await listOf(send, joinPath(root, rel));
      const name = (entry) => rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (conditional && !listed.some((entry) => included(name(entry))))
        return;
      if (rel !== "")
        walked.dirs.push(rel);
      for (const entry of listed) {
        const path = name(entry);
        if (ignored(path))
          continue;
        if (entry.type === "directory")
          next.push({ rel: path, conditional: !included(path) });
        else if (!included(path))
          continue;
        else if (entry.type === "file")
          walked.files.push(path);
        else if (entry.type === "symlink")
          walked.links.push(path);
        else
          throw new MachineWireError("unsupported_path_kind", `unsupported_path_kind: ${joinPath(root, path)}`);
      }
    });
    level = next;
  }
  return walked;
};
var statOf = async (send, path) => {
  const reply = await send("fs.stat", { path });
  const mode = isRecord4(reply) ? reply["mode"] : undefined;
  const size = isRecord4(reply) ? reply["size"] : undefined;
  if (typeof mode !== "number" || typeof size !== "number")
    throw new MachineWireError("protocol_violation", `fs.stat of ${path} answered no numeric mode and size`);
  return { mode: mode & 4095, size };
};
var linkTargets = async (send, root, links) => {
  const targets = [];
  for (const chunk of chunksOf(links)) {
    const out = await runShell(send, `cd -- ${quote(root)} && for p in ${chunk.map(quote).join(" ")}; do t=$(readlink -- "$p" && printf x) || exit 1; t=\${t%x}; printf '%s\\0' "\${t%?}"; done`, "reading the tree's symlinks");
    const read = out.split("\x00");
    if (read.length !== chunk.length + 1)
      throw new MachineWireError("tree_step_failed", `read ${read.length - 1} of ${chunk.length} symlinks`);
    targets.push(...read.slice(0, chunk.length));
  }
  return targets;
};
var packRemoteTree = async (deps, args) => {
  const root = treePathArg(args);
  const walked = await walk(deps.send, root, args);
  const entries = [];
  const files = [];
  await pool(walked.dirs, TREE_CONCURRENCY, async (path) => {
    const { mode } = await statOf(deps.send, joinPath(root, path));
    entries.push({ path, kind: "dir", mode });
  });
  await pool(walked.files, TREE_CONCURRENCY, async (path) => {
    const at = joinPath(root, path);
    const { mode, size } = await statOf(deps.send, at);
    const data = await deps.readWhole(at);
    if (data.length !== size)
      throw new MachineWireError("file_changed", `${at} changed while it was read: fs.stat said ${size} bytes, the read gave ${data.length}`);
    entries.push({ path, kind: "file", mode, data });
    files.push({ path, data });
  });
  const targets = await linkTargets(deps.send, root, walked.links);
  walked.links.forEach((path, at) => {
    const link = targets[at] ?? "";
    if (linkTargetStaysInside(path, link))
      entries.push({ path, kind: "symlink", mode: 511, link });
  });
  const verifiedFiles = await verifyFiles(deps.send, root, files);
  return {
    bytes: packTreeEntries(entries),
    fileCount: files.length,
    dirCount: walked.dirs.length,
    symlinkCount: entries.filter((entry) => entry.kind === "symlink").length,
    totalBytes: files.reduce((sum, file) => sum + file.data.length, 0),
    verifiedFiles
  };
};

// packages/bunshin-ts-relay/src/tree-transfer.ts
var TREE_PACK = "fs.tree.pack";
var TREE_APPLY = "fs.tree.apply";
var NEEDS = {
  [TREE_PACK]: ["fs.list", "fs.stat", "fs.read", "shell"],
  [TREE_APPLY]: ["fs.write", "fs.write_range", "shell"]
};
var composedTreeOps = (ops, os) => os === "win32" || os === "windows" ? [] : Object.entries(NEEDS).filter(([op, needs]) => !ops.includes(op) && needs.every((need) => ops.includes(need))).map(([op]) => op);
var isTreeOp = (capability) => capability === TREE_PACK || capability === TREE_APPLY;
var runComposedTreeOp = async (capability, args, deps) => {
  const record = isRecord4(args) ? args : {};
  if (capability === TREE_APPLY)
    return applyTree(deps.send, record, deps.artifacts.take(record["artifact"]));
  const { bytes, ...summary } = await packRemoteTree(deps, record);
  return { ...summary, archiveBytes: bytes.length, artifact: deps.artifacts.hold(bytes) };
};

// packages/bunshin-ts-relay/src/records.ts
var isRecord5 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var malformed3 = (what) => {
  throw new LocalApiError("protocol_violation", `${what} is malformed`);
};
var strings = (value) => Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
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
  const limits = description["limits"];
  const readMaxBytes = isRecord5(limits) ? limits["read_max_bytes"] : undefined;
  return {
    kind: "described",
    ...os === undefined ? {} : { os },
    ...arch === undefined ? {} : { arch },
    tags: strings(description["tags"]),
    ...build === undefined ? {} : { build },
    ...host === undefined ? {} : { host },
    ops: opsOf(description["ops"]),
    features: strings(description["features"]),
    ...typeof readMaxBytes === "number" && Number.isSafeInteger(readMaxBytes) && readMaxBytes > 0 ? { readMaxBytes } : {}
  };
};
var recordOf = (row, description) => {
  const unreachable = description?.kind === "unreachable" ? description : undefined;
  const known = description?.kind === "described" ? description : undefined;
  const unsupported = row.state === "unsupported" || unreachable !== undefined;
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
        capabilities: unsupported || known === undefined ? [] : capabilitiesOf(known)
      }
    ],
    connection: online ? "relay" : "none",
    protocolFeatures: unsupported ? [] : known?.features ?? [],
    ...known?.build === undefined ? {} : { build: known.build },
    ...known?.host === undefined ? {} : { host: known.host },
    ...unsupported ? { unsupported: true } : {},
    ...unreachable === undefined ? {} : { attention: `unreachable after ${unreachable.latencyMs} ms: ${unreachable.reason}` }
  };
};
var localRecordOf = (device) => ({
  id: device.id,
  alias: device.name,
  os: "unknown",
  arch: "unknown",
  tags: [],
  state: "online",
  kind: "enrolled",
  routes: [{ kind: "direct", machineId: device.id, online: true, capabilities: [] }],
  connection: "none",
  protocolFeatures: [],
  unsupported: true,
  attention: "this device: the device service runs no machine operations on its own device"
});
var composedOf = (description) => composedTreeOps(description.ops.map((op) => op.name), description.os);
var capabilitiesOf = (description) => [
  ...description.ops.map((op) => op.name),
  ...composedOf(description)
];
var toolsOf = (description) => {
  const composed = composedOf(description).map((name) => ({
    name,
    description: "composed by the relay transport from the device's file and shell ops"
  }));
  return [...description.ops, ...composed].map((op) => ({
    name: op.name,
    capability: op.name,
    inputSchema: { type: "object", additionalProperties: true },
    transport: "built-in",
    version: op.version ?? "1",
    ...op.description === undefined ? {} : { description: op.description }
  }));
};

// packages/bunshin-ts-relay/src/directory.ts
var CONNECTION_FAILURES = new Set([
  "closed",
  "not_connected",
  "server_proof_invalid",
  "insecure_state_dir",
  "refused"
]);
var isConnectionFailure = (error) => error instanceof RelayTransportError && CONNECTION_FAILURES.has(error.code);
var reasonOf = (error) => error instanceof Error ? error.message : String(error);
var createDirectory = (deps) => {
  const descriptions = new Map;
  const unreachable = new Map;
  const RETRY_UNREACHABLE_MS = deps.retryUnreachableMs ?? 30000;
  const now = deps.now ?? (() => performance.now());
  const failedAt = new Map;
  let listedUnsupported = new Set;
  let localDevice;
  const describe = async (device) => {
    const cached = descriptions.get(device);
    if (cached !== undefined)
      return cached;
    const started = performance.now();
    const giveUp = (reason) => ({
      kind: "unreachable",
      reason,
      latencyMs: Math.round(performance.now() - started)
    });
    let stop = () => {};
    const silent = new Promise((resolve) => {
      stop = deps.timer(() => resolve(giveUp(`machine.describe did not answer within ${deps.describeTimeoutMs} ms`)), deps.describeTimeoutMs);
    });
    const answer = deps.request("machine.describe", { device }).then((data) => {
      const described = descriptionOf(data);
      descriptions.set(device, described);
      return described;
    }).catch((error) => {
      if (isConnectionFailure(error))
        throw error;
      return giveUp(reasonOf(error));
    });
    const described = await Promise.race([answer, silent]).finally(stop);
    if (described.kind === "described") {
      unreachable.delete(device);
      return described;
    }
    unreachable.set(device, described);
    answer.catch(() => {
      return;
    });
    return described;
  };
  const unasked = (device, state) => {
    if (!unreachable.has(device))
      return false;
    if (state === "offline")
      return true;
    const failed = failedAt.get(device);
    if (failed === undefined || failed.state === "offline")
      return false;
    if (now() - failed.at < RETRY_UNREACHABLE_MS)
      return true;
    failedAt.delete(device);
    unreachable.delete(device);
    return false;
  };
  const recordFor = async (row) => {
    if (row.state === "unsupported")
      return recordOf(row, descriptions.get(row.device));
    if (unasked(row.device, row.state)) {
      const known = descriptions.get(row.device);
      return recordOf(row, known ?? (row.state === "offline" ? undefined : unreachable.get(row.device)));
    }
    const described = await describe(row.device);
    if (described.kind === "unreachable")
      failedAt.set(row.device, { at: now(), state: row.state });
    else
      failedAt.delete(row.device);
    const offlineUnknown = row.state === "offline" && described.kind === "unreachable";
    return recordOf(row, offlineUnknown ? undefined : described);
  };
  return {
    listMachines: async () => {
      const [listed, status] = await Promise.all([deps.request("machine.list"), deps.status()]);
      const rows = machineRowsOf(listed);
      listedUnsupported = new Set(rows.filter((row) => row.state === "unsupported").map((row) => row.device));
      const records = await Promise.all(rows.map(recordFor));
      const self = status.device;
      localDevice = self?.id;
      if (self === null || rows.some((row) => row.device === self.id))
        return records;
      return [...records, localRecordOf(self)];
    },
    listTools: async (machineId) => {
      if (listedUnsupported.has(machineId))
        return [];
      const cached = descriptions.get(machineId);
      if (cached !== undefined)
        return toolsOf(cached);
      if (machineId === localDevice || unreachable.has(machineId))
        return [];
      const described = await describe(machineId);
      return described.kind === "described" ? toolsOf(described) : [];
    },
    deviceOpsOf: async (machineId) => {
      const described = await describe(machineId);
      return described.kind === "described" ? described.ops.map((op) => op.name) : [];
    },
    readLimitOf: async (machineId) => {
      const described = await describe(machineId);
      return described.kind === "described" ? described.readMaxBytes : undefined;
    }
  };
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
var violation3 = (detail) => {
  throw new LocalApiError("protocol_violation", detail);
};

class BlobAssembler {
  #open = new Map;
  open(id, opId, bytes, sha256) {
    if (this.#open.has(id))
      return violation3("a blob id opened twice");
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > LOCAL_BLOB_MAX)
      return violation3("a result blob over LOCAL_BLOB_MAX");
    this.#open.set(id, { opId, bytes, sha256, parts: [], received: 0 });
  }
  chunk(id, off, b) {
    const blob = this.#current(id);
    const data = new Uint8Array(Buffer.from(b, "base64"));
    if (off !== blob.received || blob.received + data.length > blob.bytes)
      return violation3("a result blob chunk out of order");
    blob.parts.push(data);
    blob.received += data.length;
  }
  done(id) {
    const blob = this.#current(id);
    this.#open.delete(id);
    if (blob.received !== blob.bytes)
      return violation3("a result blob done before its last chunk");
    const data = new Uint8Array(blob.bytes);
    let at = 0;
    for (const part of blob.parts) {
      data.set(part, at);
      at += part.length;
    }
    return sha256Hex(data) === blob.sha256 ? { opId: blob.opId, data } : violation3("a result blob digest mismatch");
  }
  abort(id) {
    const blob = this.#current(id);
    this.#open.delete(id);
    return blob.opId;
  }
  #current(id) {
    return this.#open.get(id) ?? violation3("a result blob that is not open");
  }
}

// packages/bunshin-ts-relay/src/contract-error.ts
var MISSING_PATH_OPS = new Set(["fs.read", "fs.stat", "fs.list", "fs.grep"]);
var contractErrorOf = (capability, code, message) => code === "not_found" && message.startsWith("ENOENT:") && MISSING_PATH_OPS.has(capability) ? { code: "missing_path", message: "path does not exist" } : { code, message };

// packages/bunshin-ts-relay/src/machine-uploads.ts
var DROP_PART = { index: 0, count: 2, b: "AA==" };

class MachineUploads {
  #wire;
  #waiting = [];
  #open = 0;
  constructor(wire) {
    this.#wire = wire;
  }
  get waiting() {
    return this.#waiting.length;
  }
  async send(json, final, wanted, signal) {
    if (!await this.#take(signal))
      return;
    try {
      if (!wanted())
        return;
      const upload_id = mintId();
      const sent = await Promise.allSettled(uploadParts(json).map((part) => this.#wire.request("machine.batch_part", { upload_id, ...part })));
      const failed = sent.find((s) => s.status === "rejected");
      if (failed === undefined && wanted()) {
        await final(upload_id);
        return;
      }
      await this.#drop(upload_id);
      if (failed !== undefined) {
        const reason = failed.reason;
        throw reason;
      }
    } finally {
      this.#give();
    }
  }
  async#drop(upload_id) {
    await this.#wire.request("machine.batch_part", { upload_id, ...DROP_PART }).then(() => {
      return;
    }, () => {
      return;
    });
  }
  #take(signal) {
    if (this.#open < MACHINE_UPLOADS_OPEN_MAX) {
      this.#open += 1;
      return Promise.resolve(true);
    }
    if (signal?.aborted === true)
      return Promise.resolve(false);
    return new Promise((resolve) => {
      const enter = () => {
        signal?.removeEventListener("abort", leave);
        resolve(true);
      };
      const leave = () => {
        this.#waiting.splice(this.#waiting.indexOf(enter), 1);
        resolve(false);
      };
      this.#waiting.push(enter);
      signal?.addEventListener("abort", leave, { once: true });
    });
  }
  #give() {
    const next = this.#waiting.shift();
    if (next === undefined)
      this.#open -= 1;
    else
      next();
  }
}

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
  #uploads;
  constructor(wire, sessionRef, timer, timeoutMs) {
    this.#wire = wire;
    this.#uploads = new MachineUploads(wire);
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
      this.#sendBatch(call.machineId, op, opId, signal).catch((error) => {
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
    const state = isRecord4(data) ? data["state"] : undefined;
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
  async#sendBatch(device, op, opId, signal) {
    const ref = this.#sessionRef === undefined ? {} : { session_ref: this.#sessionRef };
    const inline = { device, ops: [op], ...ref };
    if (lineBytes({ id: "0".repeat(16), type: "machine.batch", ...inline }) <= LOCAL_INLINE_MAX) {
      await this.#wire.request("machine.batch", inline);
      return;
    }
    await this.#uploads.send(JSON.stringify([op]), (upload_id) => this.#wire.request("machine.batch", { device, upload_id, ...ref }), () => this.#pending.has(opId), signal);
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
        if (!isRecord4(blob))
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
    const failure = contractErrorOf(pending.call.capability, code, entry.error?.message ?? `the op was ${entry.state}`);
    pending.reject(new MachineWireError(failure.code, failure.message, opId, undefined, entry));
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
var isRecord6 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var malformed4 = (field) => {
  throw new TypeError(`the device answered a policy whose ${field} is malformed`);
};
var strings2 = (value, field) => Array.isArray(value) && value.every((v) => typeof v === "string") ? value : malformed4(field);
var SOURCES = ["ssh_config", "tailscale", "manual"];
var sourceOf = (value) => SOURCES.find((s) => s === value) ?? malformed4("bridge.sources");
var targetOf = (value) => {
  if (!isRecord6(value) || typeof value["target"] !== "string")
    return malformed4("bridge.targets");
  const { target, enabled, hostKeyFp, home } = value;
  if (enabled !== undefined && typeof enabled !== "boolean")
    return malformed4("bridge.targets");
  if (home !== undefined && typeof home !== "string")
    return malformed4("bridge.targets");
  return {
    target,
    ...enabled === undefined ? {} : { enabled },
    ...hostKeyFp === undefined ? {} : { hostKeyFp: strings2(hostKeyFp, "bridge.targets") },
    ...home === undefined ? {} : { home }
  };
};
var bridgeOf = (value) => {
  if (!isRecord6(value))
    return malformed4("bridge");
  const { enabled, sources, targets } = value;
  if (enabled !== undefined && typeof enabled !== "boolean")
    return malformed4("bridge.enabled");
  if (targets !== undefined && !Array.isArray(targets))
    return malformed4("bridge.targets");
  return {
    ...enabled === undefined ? {} : { enabled },
    ...sources === undefined ? {} : { sources: strings2(sources, "bridge.sources").map(sourceOf) },
    ...targets === undefined ? {} : { targets: targets.map(targetOf) }
  };
};
var policyOf2 = (value) => {
  if (!isRecord6(value))
    return malformed4("shape");
  const { tags, alias, pathAppend, longShellBudgetMs, bridge } = value;
  if (alias !== undefined && typeof alias !== "string")
    return malformed4("alias");
  if (longShellBudgetMs !== undefined && !Number.isInteger(longShellBudgetMs))
    return malformed4("longShellBudgetMs");
  return {
    ...tags === undefined ? {} : { tags: strings2(tags, "tags") },
    ...alias === undefined ? {} : { alias },
    ...pathAppend === undefined ? {} : { pathAppend: strings2(pathAppend, "pathAppend") },
    ...typeof longShellBudgetMs === "number" ? { longShellBudgetMs } : {},
    ...bridge === undefined ? {} : { bridge: bridgeOf(bridge) }
  };
};

// packages/bunshin-ts-relay/src/read-result.ts
var isRecord7 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var sdkResultOf = (capability, result) => {
  if (!isRecord7(result))
    return result;
  if (capability === "fs.read")
    return sdkReadResult(result);
  if (capability === "fs.write")
    return sdkWriteResult(result);
  return result;
};
var sdkWriteResult = (result) => {
  const writtenBytes = result["writtenBytes"];
  if (typeof writtenBytes !== "number" || !Number.isSafeInteger(writtenBytes) || writtenBytes < 0)
    throw new RelayTransportError("unsupported", "the device's fs.write reply carries no integer byte count, so what it wrote cannot be told");
  return { ...result, bytesWritten: writtenBytes };
};
var sdkReadResult = (result) => {
  const base64 = result["bytes"];
  if (typeof base64 !== "string")
    return result;
  const size = result["size"];
  if (typeof size !== "number" || !Number.isFinite(size))
    throw new RelayTransportError("unsupported", "the device's fs.read reply carries no numeric size, so whether the read is whole cannot be told");
  const sizeBytes = Buffer.byteLength(base64, "base64");
  const offset = typeof result["offset"] === "number" ? result["offset"] : 0;
  const truncated = offset + sizeBytes < size;
  return {
    ...result,
    bytes: { kind: truncated ? "truncated" : "full", base64 },
    sizeBytes,
    truncated
  };
};

// packages/bunshin-ts-relay/src/tree-artifacts.ts
import { randomUUID } from "node:crypto";
var ORIGIN = "https://relay-artifact.invalid/";
var urlOf = (input) => typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

class TreeArtifacts {
  #held = new Map;
  hold(bytes) {
    const key = randomUUID();
    this.#held.set(key, new Uint8Array(bytes));
    return {
      kind: "artifact",
      sha256: sha256Hex2(bytes),
      size: bytes.length,
      url: `${ORIGIN}${key}`
    };
  }
  take(ref) {
    const url = isRecord4(ref) ? ref["url"] : undefined;
    const key = typeof url === "string" && url.startsWith(ORIGIN) ? url.slice(ORIGIN.length) : "";
    const bytes = this.#held.get(key);
    if (bytes === undefined || !isRecord4(ref) || ref["sha256"] !== sha256Hex2(bytes))
      throw new MachineWireError("artifact_missing", "fs.tree.apply names no archive this transport holds; upload it with this transport's uploadArtifact first");
    this.#held.delete(key);
    return bytes;
  }
  clear() {
    this.#held.clear();
  }
  fetch = Object.assign(async (input, init) => {
    const url = urlOf(input);
    if (!url.startsWith(ORIGIN))
      return fetch(input, init);
    const key = url.slice(ORIGIN.length);
    const bytes = this.#held.get(key);
    if (bytes === undefined)
      return new Response(null, { status: 404 });
    this.#held.delete(key);
    return new Response(bytes);
  }, { preconnect: fetch.preconnect });
}

// packages/bunshin-ts-relay/src/transport.ts
var SDK_TRANSPORT_VERSION = "0.1.0";
var DESCRIBE_TIMEOUT_MS = 1e4;
var SDK_CLIENT_NAMES = ["sdk"];
var createRelayTransport = (options = {}) => {
  const clientName = SDK_CLIENT_NAMES.find((name) => name === (options.clientName ?? "sdk"));
  if (clientName === undefined)
    throw new RelayTransportError("invalid_client_name", `clientName must be one of ${SDK_CLIENT_NAMES.join(", ")} (default sdk); it is a local API role, not an application name`);
  const stateDir = options.stateDir ?? serviceStateDir();
  const sessionRef = options.sessionRef ?? sessionRefFromEnv();
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const describeTimeoutMs = options.describeTimeoutMs ?? DESCRIBE_TIMEOUT_MS;
  const open = () => openConnection({
    stateDir,
    clientName,
    clientVersion: options.clientVersion ?? SDK_TRANSPORT_VERSION,
    requestTimeoutMs,
    ...options.timer === undefined ? {} : { timer: options.timer }
  });
  const opListeners = new Set;
  const closeListeners = new Set;
  let session;
  let closed = false;
  const artifacts = new TreeArtifacts;
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
  const directory = createDirectory({
    request,
    status: async () => statusOf2((await current()).wire),
    timer: options.timer ?? defaultTimer,
    describeTimeoutMs,
    ...options.retryUnreachableMs === undefined ? {} : { retryUnreachableMs: options.retryUnreachableMs }
  });
  const invokeOp = async (machineId, capability, args, metadata, terminalTimeoutMs, signal) => {
    const { invoker } = await current();
    const token = metadata?.capabilityToken;
    const deadlineMs = terminalTimeoutMs === undefined ? undefined : Date.now() + terminalTimeoutMs;
    const send = (op, opArgs, opId) => invoker.invoke({
      machineId,
      capability: op,
      args: opArgs,
      ...opId === undefined ? {} : { opId },
      ...deadlineMs === undefined ? {} : { deadlineMs },
      ...token === undefined ? {} : { constraints: constraintsOf(token, machineId, opArgs, metadata?.taskId) },
      ...signal === undefined ? {} : { signal }
    });
    const sendRead = (op, opArgs, opId) => {
      const whole = wholeReadPath(op, opArgs);
      return send(op, opArgs, opId).catch(async (error) => {
        const limit = whole !== undefined && isLimitExceeded(error) ? await directory.readLimitOf(machineId) : undefined;
        if (whole === undefined || limit === undefined)
          throw error;
        const chunkOps = {
          read: (chunk) => send("fs.read", chunk, undefined),
          stat: () => send("fs.stat", { path: whole }, undefined)
        };
        return readInChunks(whole, limit, chunkOps, error);
      });
    };
    if (isTreeOp(capability) && !(await directory.deviceOpsOf(machineId)).includes(capability))
      return runComposedTreeOp(capability, args, {
        send: (op, opArgs) => send(op, opArgs, undefined),
        readWhole: async (path) => {
          const reply = await sendRead("fs.read", { path }, undefined);
          const bytes = isRecord4(reply) ? reply["bytes"] : undefined;
          return typeof bytes === "string" ? Buffer.from(bytes, "base64") : violation2(`an fs.read of ${path} answered without base64 bytes`);
        },
        artifacts
      });
    if (isPieceWrite(capability, args)) {
      const permits = (op, opArgs) => token === undefined || tokenAllows(token, machineId, op, opArgs, metadata?.taskId);
      const plan = pieceWritePlan(args, await directory.deviceOpsOf(machineId), permits);
      if (plan !== undefined)
        return sdkResultOf(capability, await writeLarge((op, a) => send(op, a, undefined), args, plan.verify));
    }
    return sdkResultOf(capability, await sendRead(capability, args, metadata?.opId));
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
      artifacts.clear();
      for (const listener of [...closeListeners])
        listener();
      const opened = await session?.catch(() => {
        return;
      });
      opened?.wire.close();
    },
    uploadArtifact: async (bytes) => artifacts.hold(bytes),
    fetchArtifact: artifacts.fetch,
    listMachines: directory.listMachines,
    listTools: directory.listTools,
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
      stateDir: options.stateDir ?? serviceStateDir(),
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
