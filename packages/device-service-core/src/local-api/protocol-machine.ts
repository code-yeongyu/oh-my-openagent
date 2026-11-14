// Vendored from sisyphuslabs/omo-relay-daemon@4ed58920002306a95bf92fe99ca448be89d7103f packages/local-api/src/protocol-machine.ts
import type { Empty, EventOf, JsonObject } from "./protocol.ts";
import type {
  MachineBlobAbortReason,
  MachineLookupState,
  MachineOpState,
  MachineState,
} from "./vocabulary.ts";

// Machine operations on the local API v1 (#267, design 9.3). A request names a device, never a session: none needs
// session.attach. machine.batch is acknowledged at once with its batch_id; each op then reports machine.op_state and
// one machine.op_result on the same connection, so the request timeout bounds the acknowledgement only.
export type MachineOp = {
  readonly op_id: string;
  readonly op: string;
  readonly args: JsonObject;
  readonly deadline_ms?: number;
  readonly constraints?: JsonObject;
};
export type MachineList = { readonly id: string; readonly type: "machine.list" };
export type MachineDescribe = {
  readonly id: string;
  readonly type: "machine.describe";
  readonly device: string;
};
// A batch whose line would exceed LOCAL_INLINE_MAX travels as an upload of the UTF-8 JSON of its ops array.
export type MachineBatch =
  | {
      readonly id: string;
      readonly type: "machine.batch";
      readonly device: string;
      readonly ops: readonly MachineOp[];
      readonly session_ref?: string;
    }
  | {
      readonly id: string;
      readonly type: "machine.batch";
      readonly device: string;
      readonly upload_id: string;
      readonly session_ref?: string;
    };
export type MachineBatchPart = {
  readonly id: string;
  readonly type: "machine.batch_part";
  readonly upload_id: string;
  readonly index: number;
  readonly count: number;
  readonly b: string;
};
export type MachineCancel = {
  readonly id: string;
  readonly type: "machine.cancel";
  readonly op_ids: readonly string[];
};
export type MachineCredit = {
  readonly id: string;
  readonly type: "machine.credit";
  readonly handle: string;
  readonly bytes: number;
};
export type MachineResultOf = {
  readonly id: string;
  readonly type: "machine.result_of";
  readonly op_id: string;
};
export type MachineEventsSubscribe = {
  readonly id: string;
  readonly type: "machine.events.subscribe";
};
export type MachineRequest =
  | MachineList
  | MachineDescribe
  | MachineBatch
  | MachineBatchPart
  | MachineCancel
  | MachineCredit
  | MachineResultOf
  | MachineEventsSubscribe;

export type MachineRow = {
  readonly device: string;
  readonly label: string;
  readonly state: MachineState;
};
export type MachineResponseData = {
  readonly "machine.list": { readonly machines: readonly MachineRow[] };
  // The device's own description (os, arch, tags, build, ops, features, limits), passed through as it answered.
  readonly "machine.describe": { readonly device: string; readonly description: JsonObject };
  readonly "machine.batch": { readonly batch_id: string };
  readonly "machine.batch_part": { readonly received: number };
  readonly "machine.cancel": Empty;
  readonly "machine.credit": Empty;
  readonly "machine.result_of": { readonly state: MachineLookupState };
  readonly "machine.events.subscribe": Empty;
};

export type MachineBlobRef = {
  readonly id: string;
  readonly bytes: number;
  readonly sha256: string;
};
// The op's timeline on the sender's clock (row 5 D8), ms since the epoch: queued to leave, sent on the connection,
// stored for delivery, then the target's receipt (dispatched, settled) and the local result (applied).
export type MachineOpTiming = {
  readonly enqueued_ms?: number;
  readonly flushed_ms?: number;
  readonly confirmed_ms?: number;
  readonly dispatched_ms?: number;
  readonly settled_ms?: number;
  readonly applied_ms?: number;
};
export type MachineOpStateEvent = EventOf<
  "machine.op_state",
  { readonly op_id: string; readonly state: MachineOpState; readonly timing?: MachineOpTiming }
>;
// The op's result as the device reported it: inline, or as a blob whose chunks follow (machine.blob_*).
export type MachineOpResult = EventOf<
  "machine.op_result",
  { readonly op_id: string } & (
    | { readonly response: JsonObject }
    | { readonly blob: MachineBlobRef }
  )
>;
export type MachineOutput = EventOf<
  "machine.output",
  { readonly handle: string; readonly seq: number; readonly bytes: string }
>;
export type MachineChanged = EventOf<
  "machine.changed",
  { readonly device: string; readonly state: MachineState }
>;
export type MachineBlobChunk = EventOf<
  "machine.blob_chunk",
  { readonly id: string; readonly off: number; readonly b: string }
>;
export type MachineBlobDone = EventOf<"machine.blob_done", { readonly id: string }>;
export type MachineBlobAbort = EventOf<
  "machine.blob_abort",
  { readonly id: string; readonly reason: MachineBlobAbortReason }
>;
export type MachineEvent =
  | MachineOpStateEvent
  | MachineOpResult
  | MachineOutput
  | MachineChanged
  | MachineBlobChunk
  | MachineBlobDone
  | MachineBlobAbort;
