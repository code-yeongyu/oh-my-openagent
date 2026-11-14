// Vendored from sisyphuslabs/omo-relay-daemon@4ed58920002306a95bf92fe99ca448be89d7103f packages/local-api/src/validate-requests.ts
import { toHex } from "./bytes-encoding.ts";
import { SESSION_PROJECT_MAX_CHARS, SESSION_READ_TAIL_MAX } from "./spec-proto.ts";
import type {
  AttachFrom,
  AttachResume,
  EnvironmentReport,
  LocalRequest,
  RequestType,
  SessionFilter,
} from "./protocol.ts";
import {
  COMMAND_REQUEST_VALIDATORS,
  requestFields,
  type RequestValidators,
} from "./validate-command.ts";
import {
  absolutePath,
  base64Bytes,
  bool,
  entryId,
  exactly,
  fail,
  type Fields,
  keysOf,
  localId,
  semver,
  text,
  uint,
} from "./validate-fields.ts";
import { MACHINE_REQUEST_VALIDATORS } from "./validate-machine.ts";
import {
  DELEGATED_REQUEST_VALIDATORS,
  endpointsRegister,
  endpointsUnregister,
} from "./validate-delegated.ts";
import { attachId, deviceId, deviceRef, sessionId } from "./validate-shapes.ts";
import { PRESENTER_REQUEST_VALIDATORS } from "./validate-presenter.ts";
import { DELIVERIES_REQUEST_VALIDATORS } from "./validate-deliveries.ts";
import { SESSION_WAKE_VALIDATORS } from "./validate-session-wake.ts";
import { updateCommittedOf } from "./validate-update.ts";
import { FILTER_KEYS, SESSION_ROW_STATES } from "./vocabulary.ts";

const ENVIRONMENTS_MAX = 1024;
const PKCS8_KEY_BYTES = 48;
// PKCS#8 v1 DER of a raw 32-byte private key: SEQUENCE { version 0, AlgorithmIdentifier { OID }, OCTET STRING {
// OCTET STRING (32) } }; the OID is 1.3.101.112 for Ed25519 and 1.3.101.110 for X25519.
const PKCS8_PREFIX = {
  ed25519: "302e020100300506032b657004220420",
  x25519: "302e020100300506032b656e04220420",
};

const pkcs8 = (v: unknown, algorithm: "ed25519" | "x25519", what: string): string => {
  const bytes = base64Bytes(v, PKCS8_KEY_BYTES, what);
  const prefix = toHex(bytes.subarray(0, 16));
  const exact = bytes.length === PKCS8_KEY_BYTES && prefix === PKCS8_PREFIX[algorithm];
  return exact && typeof v === "string" ? v : fail(what);
};

const filterOf = (v: unknown): SessionFilter => {
  const { device, project, state } = exactly(v, [], FILTER_KEYS, "filter");
  return {
    ...(device === undefined ? {} : { device: deviceId(device, "filter.device") }),
    ...(project === undefined
      ? {}
      : { project: text(project, SESSION_PROJECT_MAX_CHARS, "filter.project") }),
    ...(state === undefined
      ? {}
      : { state: SESSION_ROW_STATES.find((s) => s === state) ?? fail("filter.state") }),
  };
};

const environmentsOf = (v: unknown): readonly EnvironmentReport[] => {
  if (!Array.isArray(v) || v.length > ENVIRONMENTS_MAX) return fail("environments");
  const rows = v.map((e): EnvironmentReport => {
    const m = exactly(e, ["environment_id", "revoked", "closed"], [], "environment");
    return {
      environment_id: text(m["environment_id"], 128, "environment_id"),
      revoked: uint(m["revoked"], 0, Number.MAX_SAFE_INTEGER, "revoked"),
      closed: uint(m["closed"], 0, Number.MAX_SAFE_INTEGER, "closed"),
    };
  });
  return new Set(rows.map((r) => r.environment_id)).size === rows.length
    ? rows
    : fail("duplicate environment_id");
};

// #774: the last record a reattaching client applied, by its attach_id and that record's seq.
const resumeOf = (v: unknown): AttachResume => {
  const m = exactly(v, ["attach_id", "seq"], [], "resume");
  const seq = uint(m["seq"], 0, Number.MAX_SAFE_INTEGER, "resume.seq");
  return { attach_id: attachId(m["attach_id"]), seq };
};
// #896: the newest entry the reattaching client holds.
const fromOf = (v: unknown): AttachFrom => {
  const m = exactly(v, ["last_entry_id"], [], "from");
  return { last_entry_id: entryId(m["last_entry_id"], "from.last_entry_id") };
};
const bare = (v: Fields): void => {
  requestFields(v, []);
};

const VALIDATORS: RequestValidators<RequestType> = {
  ...COMMAND_REQUEST_VALIDATORS,
  ...MACHINE_REQUEST_VALIDATORS,
  ...DELEGATED_REQUEST_VALIDATORS,
  ...PRESENTER_REQUEST_VALIDATORS,
  ...DELIVERIES_REQUEST_VALIDATORS,
  authenticate: (v, id) => {
    const m = requestFields(v, ["client_proof"]);
    return { id, type: "authenticate", client_proof: text(m["client_proof"], 64, "client_proof") };
  },
  "status.get": (v, id) => {
    const { exe, sign_in_reason: reason } = requestFields(v, [], ["exe", "sign_in_reason"]);
    if (exe !== undefined && exe !== true) return fail("exe");
    if (reason !== undefined && reason !== true) return fail("sign_in_reason");
    return {
      id,
      type: "status.get",
      ...(exe === true ? { exe } : {}),
      ...(reason === true ? { sign_in_reason: reason } : {}),
    };
  },
  "status.subscribe": (v, id) => {
    bare(v);
    return { id, type: "status.subscribe" };
  },
  "control.attach.get": (v, id) => {
    bare(v);
    return { id, type: "control.attach.get" };
  },
  "control.attach.set": (v, id) => {
    const attached = bool(requestFields(v, ["attached"])["attached"], "attached");
    return { id, type: "control.attach.set", attached };
  },
  "control.remote_commands.get": (v, id) => {
    bare(v);
    return { id, type: "control.remote_commands.get" };
  },
  "control.remote_commands.set": (v, id) => {
    const enabled = bool(requestFields(v, ["enabled"])["enabled"], "enabled");
    return { id, type: "control.remote_commands.set", enabled };
  },
  ...SESSION_WAKE_VALIDATORS,
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
      version: semver(m["version"], "version"),
    };
  },
  "device.adopt": (v, id) => {
    const m = requestFields(
      v,
      ["device", "signing_private_key", "sealing_private_key"],
      ["account", "sign_in_reason"],
    );
    const reason = m["sign_in_reason"];
    if (reason !== undefined && reason !== true) return fail("sign_in_reason");
    return {
      id,
      type: "device.adopt",
      device: deviceRef(m["device"]),
      ...(m["account"] === undefined ? {} : { account: text(m["account"], 256, "account") }),
      ...(reason === true ? { sign_in_reason: reason } : {}),
      signing_private_key: pkcs8(m["signing_private_key"], "ed25519", "signing_private_key"),
      sealing_private_key: pkcs8(m["sealing_private_key"], "x25519", "sealing_private_key"),
    };
  },
  "device.forget": (v, id) => {
    bare(v);
    return { id, type: "device.forget" };
  },
  "device.info": (v, id) => {
    bare(v);
    return { id, type: "device.info" };
  },
  "endpoints.register": endpointsRegister,
  "endpoints.unregister": endpointsUnregister,
  "devices.list": (v, id) => {
    const { managed } = requestFields(v, [], ["managed"]);
    if (managed !== undefined && managed !== true) return fail("managed");
    return { id, type: "devices.list", ...(managed === undefined ? {} : { managed }) };
  },
  "sessions.events.subscribe": (v, id) => {
    bare(v);
    return { id, type: "sessions.events.subscribe" };
  },
  "sessions.list": (v, id) => {
    const { filter, rows } = requestFields(v, [], ["filter", "rows"]);
    if (rows !== undefined && rows !== 2 && rows !== 3) return fail("rows");
    return {
      id,
      type: "sessions.list",
      ...(filter === undefined ? {} : { filter: filterOf(filter) }),
      ...(rows === undefined ? {} : { rows }),
    };
  },
  "session.attach": (v, id) => {
    const m = requestFields(v, ["device", "session_id"], ["seqs", "resume", "from"]);
    const { seqs, resume, from } = m;
    if (seqs !== undefined && seqs !== true) return fail("seqs");
    return {
      id,
      type: "session.attach",
      device: deviceId(m["device"]),
      session_id: sessionId(m["session_id"]),
      ...(seqs === undefined ? {} : { seqs }),
      ...(resume === undefined ? {} : { resume: resumeOf(resume) }),
      ...(from === undefined ? {} : { from: fromOf(from) }),
    };
  },
  "session.detach": (v, id) => ({
    id,
    type: "session.detach",
    attach: localId(requestFields(v, ["attach"])["attach"], "attach"),
  }),
  "session.read": (v, id) => {
    const m = requestFields(v, ["attach"], ["before_entry_id", "tail"]);
    const before = m["before_entry_id"];
    const tail = m["tail"];
    return {
      id,
      type: "session.read",
      attach: localId(m["attach"], "attach"),
      ...(before === undefined ? {} : { before_entry_id: entryId(before, "before_entry_id") }),
      ...(tail === undefined ? {} : { tail: uint(tail, 1, SESSION_READ_TAIL_MAX, "tail") }),
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
      complete: bool(m["complete"], "complete"),
    };
  },
  "owner.shutdown_for_upgrade": (v, id) => {
    const target_version = semver(
      requestFields(v, ["target_version"])["target_version"],
      "target_version",
    );
    return { id, type: "owner.shutdown_for_upgrade", target_version };
  },
  "owner.update_committed": (v, id) => updateCommittedOf(requestFields(v, ["update_id"]), id),
};

export const REQUEST_TYPES: readonly RequestType[] = keysOf(VALIDATORS);
export const isRequestType = (v: unknown): v is RequestType => REQUEST_TYPES.some((t) => t === v);
export const validateRequestFields = (type: RequestType, v: Fields, id: string): LocalRequest =>
  VALIDATORS[type](v, id);
