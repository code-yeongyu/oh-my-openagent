// Vendored from sisyphuslabs/omo-relay-daemon@5bcdcc296c16a4c9af6f0618d5995e1e7ca0354e packages/local-api/src/validate-machine.ts
import { methodOf, ProtoError, SESSION_BLOB_MAX } from "./spec-proto.ts";
import { LOCAL_CHUNK_MAX, LOCAL_INLINE_MAX, lineBytes } from "./limits.ts";
import type { MachineOp, MachineResponseData, MachineRow } from "./protocol-machine.ts";
import { LOCAL_UPLOAD_PARTS_MAX } from "./upload.ts";
import { requestFields, type RequestValidators } from "./validate-command.ts";
import {
  base64Bytes,
  bool,
  exactly,
  fail,
  type Fields,
  isRecord,
  jsonObject,
  known,
  LABEL_MAX_CHARS,
  localId,
  oneOf,
  text,
  uint,
} from "./validate-fields.ts";
import { deviceId } from "./validate-shapes.ts";
import { COMMAND_ID_CHARS, MACHINE_LOOKUP_STATES, MACHINE_STATES } from "./vocabulary.ts";

// The machine.* requests (#267, design 9.3) and their response bodies. An op's args and constraints are opaque JSON
// objects: the target device's executor owns the op set and every argument; here only the op NAME (the decision 0011
// method grammar, at most 64 characters), the ids and the sizes are checked.
type MachineType =
  | "machine.list"
  | "machine.describe"
  | "machine.batch"
  | "machine.batch_part"
  | "machine.cancel"
  | "machine.credit"
  | "machine.result_of"
  | "machine.events.subscribe";

// One request carries at most this many ops (machine.batch) or op_ids (machine.cancel); more go in further requests.
export const MACHINE_OPS_MAX = 4_096;
// A session_ref (the caller's attribution) and a handle are at most this long.
export const MACHINE_REF_MAX_CHARS = 128;
// One machine.credit grants at most one blob's worth of output.
export const MACHINE_CREDIT_MAX_BYTES = SESSION_BLOB_MAX;

const BASE64URL = /^[A-Za-z0-9_-]+$/;
// An op_id and a batch_id: exactly 22 base64url characters, the length of a command_id.
export const machineId = (v: unknown, what: string): string =>
  typeof v === "string" && v.length === COMMAND_ID_CHARS && BASE64URL.test(v) ? v : fail(what);
export const machineRef = (v: unknown, what: string): string =>
  text(v, MACHINE_REF_MAX_CHARS, what);

const opName = (v: unknown): string => {
  try {
    return methodOf(v, "op");
  } catch (error) {
    if (error instanceof ProtoError) return fail("op");
    throw error;
  }
};

const opOf = (v: unknown): MachineOp => {
  const m = exactly(v, ["op_id", "op", "args"], ["deadline_ms", "constraints"], "op");
  const deadline = m["deadline_ms"];
  const constraints = m["constraints"];
  return {
    op_id: machineId(m["op_id"], "op_id"),
    op: opName(m["op"]),
    args: jsonObject(m["args"], "args"),
    ...(deadline === undefined
      ? {}
      : { deadline_ms: uint(deadline, 1, Number.MAX_SAFE_INTEGER, "deadline_ms") }),
    ...(constraints === undefined ? {} : { constraints: jsonObject(constraints, "constraints") }),
  };
};

const uniqueIds = (ids: readonly string[], what: string): readonly string[] =>
  new Set(ids).size === ids.length ? ids : fail(`duplicate ${what}`);

// The ops of an inline batch, or of an uploaded one once its JSON is parsed.
export const machineOpsOf = (v: unknown): readonly MachineOp[] => {
  if (!Array.isArray(v) || v.length === 0 || v.length > MACHINE_OPS_MAX) return fail("ops");
  const ops = v.map(opOf);
  uniqueIds(
    ops.map((o) => o.op_id),
    "op_id",
  );
  return ops;
};

const refOf = (m: Fields): { readonly session_ref?: string } =>
  m["session_ref"] === undefined
    ? {}
    : { session_ref: machineRef(m["session_ref"], "session_ref") };

const bare = (v: Fields): void => {
  requestFields(v, []);
};

export const MACHINE_REQUEST_VALIDATORS: RequestValidators<MachineType> = {
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
    device: deviceId(requestFields(v, ["device"])["device"]),
  }),
  "machine.batch": (v, id) => {
    if (Object.hasOwn(v, "upload_id")) {
      const m = requestFields(v, ["device", "upload_id"], ["session_ref"]);
      const upload_id = localId(m["upload_id"], "upload_id");
      return { id, type: "machine.batch", device: deviceId(m["device"]), upload_id, ...refOf(m) };
    }
    const m = requestFields(v, ["device", "ops"], ["session_ref"]);
    if (lineBytes(v) > LOCAL_INLINE_MAX)
      return fail("an inline batch over LOCAL_INLINE_MAX is an upload");
    return {
      id,
      type: "machine.batch",
      device: deviceId(m["device"]),
      ops: machineOpsOf(m["ops"]),
      ...refOf(m),
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
      b: typeof m["b"] === "string" ? m["b"] : fail("b"),
    };
  },
  "machine.cancel": (v, id) => {
    const ids = requestFields(v, ["op_ids"])["op_ids"];
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MACHINE_OPS_MAX)
      return fail("op_ids");
    const op_ids = uniqueIds(
      ids.map((o) => machineId(o, "op_id")),
      "op_id",
    );
    return { id, type: "machine.cancel", op_ids };
  },
  "machine.credit": (v, id) => {
    const m = requestFields(v, ["handle", "bytes"]);
    return {
      id,
      type: "machine.credit",
      handle: machineRef(m["handle"], "handle"),
      bytes: uint(m["bytes"], 1, MACHINE_CREDIT_MAX_BYTES, "bytes"),
    };
  },
  "machine.result_of": (v, id) => ({
    id,
    type: "machine.result_of",
    op_id: machineId(requestFields(v, ["op_id"])["op_id"], "op_id"),
  }),
};

const empty = (v: unknown): MachineResponseData["machine.cancel"] => {
  known(v, [], [], "data");
  return {};
};
const fields = (v: unknown, names: readonly string[]): Fields => known(v, names, [], "data");
const LEGACY_MACHINE_ROUTE_KINDS = ["internet", "lan"] as const;
const legacyRouteOf = (v: unknown): (typeof LEGACY_MACHINE_ROUTE_KINDS)[number] => {
  const r = known(v, ["kind", "online"], [], "machine route");
  const kind = oneOf(LEGACY_MACHINE_ROUTE_KINDS, r["kind"], "machine route kind");
  bool(r["online"], "online");
  return kind;
};
const machineRowOf = (v: unknown): MachineRow => {
  const m = known(v, ["device", "label", "state"], ["routes"], "machine row");
  const routes = m["routes"];
  if (
    routes !== undefined &&
    (!Array.isArray(routes) || routes.length > LEGACY_MACHINE_ROUTE_KINDS.length)
  )
    return fail("routes");
  const listed = routes?.map(legacyRouteOf);
  // Older services may send route status. Accept its old shape but never expose it from the current API.
  if (listed !== undefined && new Set(listed).size !== listed.length) return fail("routes");
  return {
    device: deviceId(m["device"]),
    label: text(m["label"], LABEL_MAX_CHARS, "label", 0),
    state: oneOf(MACHINE_STATES, m["state"], "machine state"),
  };
};

export const MACHINE_DATA: { readonly [T in MachineType]: (v: unknown) => MachineResponseData[T] } =
  {
    "machine.list": (v) => {
      const machines = fields(v, ["machines"])["machines"];
      return Array.isArray(machines) ? { machines: machines.map(machineRowOf) } : fail("machines");
    },
    "machine.describe": (v) => {
      const m = fields(v, ["device", "description"]);
      if (!isRecord(m["description"])) return fail("description");
      return {
        device: deviceId(m["device"]),
        description: jsonObject(m["description"], "description"),
      };
    },
    "machine.batch": (v) => ({
      batch_id: machineId(fields(v, ["batch_id"])["batch_id"], "batch_id"),
    }),
    "machine.batch_part": (v) => ({
      received: uint(
        fields(v, ["received"])["received"],
        0,
        LOCAL_UPLOAD_PARTS_MAX - 1,
        "received",
      ),
    }),
    "machine.cancel": empty,
    "machine.credit": empty,
    "machine.result_of": (v) => ({
      state: oneOf(MACHINE_LOOKUP_STATES, fields(v, ["state"])["state"], "lookup state"),
    }),
    "machine.events.subscribe": empty,
  };
