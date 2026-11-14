// Vendored from sisyphuslabs/omo-relay-daemon@5bcdcc296c16a4c9af6f0618d5995e1e7ca0354e packages/local-api/src/validate-machine-events.ts
import { STREAM_INLINE_MAX } from "./spec-proto.ts";
import { LOCAL_BLOB_MAX, LOCAL_CHUNK_MAX, LOCAL_INLINE_MAX, lineBytes } from "./limits.ts";
import type { MachineBlobRef, MachineOpResult, MachineOpTiming } from "./protocol-machine.ts";
import {
  base64Bytes,
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
import { machineId, machineRef } from "./validate-machine.ts";
import { deviceId } from "./validate-shapes.ts";
import { eventFields, type EventValidators } from "./validate-stream-events.ts";
import { MACHINE_BLOB_ABORT_REASONS, MACHINE_OP_STATES, MACHINE_STATES } from "./vocabulary.ts";

// The machine.* events (#267). A result too large for one line arrives as a blob: machine.op_result names it
// {id, bytes, sha256}, then machine.blob_chunk events carry it in order (every chunk but the last exactly
// LOCAL_CHUNK_MAX raw bytes, as session blobs) and machine.blob_done or machine.blob_abort ends it.
type MachineKind =
  | "machine.op_state"
  | "machine.op_result"
  | "machine.output"
  | "machine.changed"
  | "machine.blob_chunk"
  | "machine.blob_done"
  | "machine.blob_abort";

// Raw output bytes per machine.output: the device's stream frame cap (STREAM_INLINE_MAX).
export const MACHINE_OUTPUT_MAX_BYTES = STREAM_INLINE_MAX;

const blobId = (m: Fields): string => localId(m["id"], "blob id");
const blobRefOf = (v: unknown): MachineBlobRef => {
  const m = known(v, ["id", "bytes", "sha256"], [], "blob");
  return {
    id: blobId(m),
    bytes: uint(m["bytes"], 1, LOCAL_BLOB_MAX, "blob bytes"),
    sha256: sha256Field(m["sha256"], "blob sha256"),
  };
};
const base64Of = (v: unknown, max: number, what: string): string => {
  base64Bytes(v, max, what);
  return typeof v === "string" ? v : fail(what);
};

const TIMING_FIELDS = [
  "enqueued_ms",
  "flushed_ms",
  "confirmed_ms",
  "dispatched_ms",
  "settled_ms",
  "applied_ms",
] as const;
const timingOf = (v: unknown): MachineOpTiming => {
  const m = known(v, [], TIMING_FIELDS, "timing");
  return Object.fromEntries(
    TIMING_FIELDS.flatMap((k) =>
      m[k] === undefined ? [] : [[k, uint(m[k], 0, Number.MAX_SAFE_INTEGER, k)]],
    ),
  );
};

// A result is a blob or an inline response, told apart by which is present, so one never rides beside the other.
const opResultOf = (v: Fields): MachineOpResult => {
  const head = { type: "event", kind: "machine.op_result" } as const;
  const all = eventFields(v, ["op_id"], ["blob", "response"]);
  const shape = (name: string): Fields =>
    exactly(all, ["type", "kind", "op_id", name], [], "event");
  if (Object.hasOwn(all, "blob")) {
    const m = shape("blob");
    return { ...head, op_id: machineId(m["op_id"], "op_id"), blob: blobRefOf(m["blob"]) };
  }
  const m = shape("response");
  if (lineBytes(v) > LOCAL_INLINE_MAX)
    return fail("an inline result over LOCAL_INLINE_MAX is a blob");
  return {
    ...head,
    op_id: machineId(m["op_id"], "op_id"),
    response: jsonObject(m["response"], "response"),
  };
};

export const MACHINE_EVENT_VALIDATORS: EventValidators<MachineKind> = {
  "machine.op_state": (v) => {
    const m = eventFields(v, ["op_id", "state"], ["timing"]);
    return {
      type: "event",
      kind: "machine.op_state",
      op_id: machineId(m["op_id"], "op_id"),
      state: oneOf(MACHINE_OP_STATES, m["state"], "op state"),
      ...(m["timing"] === undefined ? {} : { timing: timingOf(m["timing"]) }),
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
      bytes: base64Of(m["bytes"], MACHINE_OUTPUT_MAX_BYTES, "bytes"),
    };
  },
  "machine.changed": (v) => {
    const m = eventFields(v, ["device", "state"]);
    return {
      type: "event",
      kind: "machine.changed",
      device: deviceId(m["device"]),
      state: oneOf(MACHINE_STATES, m["state"], "machine state"),
    };
  },
  "machine.blob_chunk": (v) => {
    const m = eventFields(v, ["id", "off", "b"]);
    return {
      type: "event",
      kind: "machine.blob_chunk",
      id: blobId(m),
      off: uint(m["off"], 0, LOCAL_BLOB_MAX, "blob off"),
      b: base64Of(m["b"], LOCAL_CHUNK_MAX, "blob chunk"),
    };
  },
  "machine.blob_done": (v) => ({
    type: "event",
    kind: "machine.blob_done",
    id: blobId(eventFields(v, ["id"])),
  }),
  "machine.blob_abort": (v) => {
    const m = eventFields(v, ["id", "reason"]);
    return {
      type: "event",
      kind: "machine.blob_abort",
      id: blobId(m),
      reason: oneOf(MACHINE_BLOB_ABORT_REASONS, m["reason"], "blob abort reason"),
    };
  },
};
