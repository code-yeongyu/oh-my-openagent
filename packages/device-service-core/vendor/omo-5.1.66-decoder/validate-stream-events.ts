import { LOCAL_BLOB_MAX, LOCAL_CHUNK_MAX } from "./limits.ts";
import type { BlobTarget, EventKind, LocalEvent } from "./protocol.ts";
import {
  base64Bytes,
  entryId,
  exactly,
  fail,
  type Fields,
  jsonObject,
  localId,
  oneOf,
  sha256Field,
  uint,
} from "./validate-fields.ts";
import { attachId, SNAPSHOT_FIELDS, snapshotBodyOf } from "./validate-shapes.ts";
import {
  ATTACH_PENDING_REASONS,
  BLOB_ABORT_REASONS,
  BLOB_OF,
  DETACH_REASONS,
} from "./vocabulary.ts";

// The events of one attach's stream: its snapshot (inline or announced as loading), its records, the blobs that
// carry anything too large for a line, and the attach lifecycle.
export type EventValidators<K extends EventKind> = {
  readonly [P in K]: (v: Fields) => Extract<LocalEvent, { readonly kind: P }>;
};
type StreamKind =
  | "session.snapshot"
  | "session.snapshot_loading"
  | "session.records"
  | "session.blob_open"
  | "session.blob_chunk"
  | "session.blob_done"
  | "session.blob_abort"
  | "session.attach_pending"
  | "session.detached";

export const eventFields = (
  v: Fields,
  names: readonly string[],
  optional: readonly string[] = [],
): Fields => exactly(v, ["type", "kind", ...names], optional, "event");
export const attachOf = (m: Fields): string => localId(m["attach"], "attach");
export const queryOf = (m: Fields): string => localId(m["query_id"], "query_id");
const blobIdOf = (m: Fields): string => localId(m["id"], "blob id");

const targetOf = (m: Fields): BlobTarget => {
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
        position: { query_id: queryOf(p), entry_id: entryId(p["entry_id"], "position.entry_id") },
      };
    }
  }
};

export const STREAM_EVENT_VALIDATORS: EventValidators<StreamKind> = {
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
      blob: localId(m["blob"], "blob"),
    };
  },
  "session.records": (v) => {
    const m = eventFields(v, ["attach", "attach_id", "records"]);
    const records = m["records"];
    if (!Array.isArray(records) || records.length === 0) return fail("records");
    const attach_id = attachId(m["attach_id"]);
    return {
      type: "event",
      kind: "session.records",
      attach: attachOf(m),
      attach_id,
      records: records.map((r) => jsonObject(r, "record")),
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
      ...targetOf(m),
    };
  },
  "session.blob_chunk": (v) => {
    const m = eventFields(v, ["attach", "id", "off", "b"]);
    base64Bytes(m["b"], LOCAL_CHUNK_MAX, "blob chunk");
    const b = typeof m["b"] === "string" ? m["b"] : fail("blob chunk");
    const off = uint(m["off"], 0, LOCAL_BLOB_MAX, "blob off");
    return {
      type: "event",
      kind: "session.blob_chunk",
      attach: attachOf(m),
      id: blobIdOf(m),
      off,
      b,
    };
  },
  "session.blob_done": (v) => {
    const m = eventFields(v, ["attach", "id"]);
    return { type: "event", kind: "session.blob_done", attach: attachOf(m), id: blobIdOf(m) };
  },
  // too_large answers a history fetch and names it (query_id, entry_id); every other reason ends the open blob.
  "session.blob_abort": (v) => {
    const head = eventFields(v, ["attach", "id", "reason"], ["query_id", "entry_id"]);
    const reason = oneOf(BLOB_ABORT_REASONS, head["reason"], "blob abort reason");
    const base = {
      type: "event",
      kind: "session.blob_abort",
      attach: attachOf(head),
      id: blobIdOf(head),
    } as const;
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
  },
};
