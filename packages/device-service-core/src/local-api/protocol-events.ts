import type { EventOf, JsonObject, JsonValue, Status } from "./protocol.ts";
import type {
  AttachPendingReason,
  BlobAbortReason,
  CommandRefusalReason,
  CommandUncertainReason,
  DetachReason,
  ListingSource,
  RoundDeviceState,
  RoundState,
  SessionRowState,
  UploadAbortReason,
} from "./vocabulary.ts";

// The pushed events of the local API v1. A payload too large for one line arrives as a blob (session.blob_*): the
// client reassembles it and applies it at its position (docs/local-api.md "Chunking").
export type ListingRow = {
  readonly device: string;
  readonly session_id: string;
  readonly title: string;
  readonly project: string;
  readonly path: string;
  readonly state: SessionRowState;
  readonly updated_ms: number;
  readonly source: ListingSource;
  readonly as_of: number;
};
export type StatusChanged = EventOf<"status.changed", { readonly status: Status }>;
export type SessionsRound = EventOf<
  "sessions.round",
  {
    readonly query_id: string;
    readonly state: RoundState;
    readonly devices: { readonly [device: string]: RoundDeviceState };
  }
>;
export type ListingBegin = EventOf<
  "sessions.listing_begin",
  { readonly query_id: string; readonly revision: number }
>;
export type ListingRows = EventOf<
  "sessions.listing_rows",
  { readonly query_id: string; readonly revision: number; readonly rows: readonly ListingRow[] }
>;
export type ListingEnd = EventOf<
  "sessions.listing_end",
  { readonly query_id: string; readonly revision: number; readonly incomplete: readonly string[] }
>;

export type SnapshotBody = {
  readonly attach_id: number;
  readonly cursor: { readonly marker_id: string; readonly last_entry_id: string | null };
  readonly state: JsonObject;
  readonly entries: readonly JsonValue[];
  readonly history_truncated: boolean;
  readonly oldest_entry_id: string | null;
};
export type SessionSnapshot = EventOf<
  "session.snapshot",
  { readonly attach: string } & SnapshotBody
>;
export type SnapshotLoading = EventOf<
  "session.snapshot_loading",
  { readonly attach: string; readonly blob: string }
>;
export type SessionRecords = EventOf<
  "session.records",
  { readonly attach: string; readonly attach_id: number; readonly records: readonly JsonObject[] }
>;

// Where a reassembled blob applies: a snapshot of one attach generation, one record of its ordered stream, or one
// entry of a history page (session.read_result lists it as an entry_ref).
export type BlobTarget =
  | { readonly of: "state"; readonly position: { readonly attach_id: number } }
  | {
      readonly of: "record";
      readonly position: { readonly attach_id: number; readonly seq: number };
    }
  | {
      readonly of: "entry";
      readonly position: { readonly query_id: string; readonly entry_id: string };
    };
export type BlobOpen = EventOf<
  "session.blob_open",
  {
    readonly attach: string;
    readonly id: string;
    readonly bytes: number;
    readonly sha256: string;
  } & BlobTarget
>;
export type BlobChunk = EventOf<
  "session.blob_chunk",
  { readonly attach: string; readonly id: string; readonly off: number; readonly b: string }
>;
export type BlobDone = EventOf<
  "session.blob_done",
  { readonly attach: string; readonly id: string }
>;
export type BlobAbort = EventOf<
  "session.blob_abort",
  { readonly attach: string; readonly id: string } & (
    | { readonly reason: "too_large"; readonly query_id: string; readonly entry_id: string }
    | { readonly reason: Exclude<BlobAbortReason, "too_large"> }
  )
>;
export type AttachPending = EventOf<
  "session.attach_pending",
  { readonly attach: string; readonly reason: AttachPendingReason }
>;
export type Detached = EventOf<
  "session.detached",
  { readonly attach: string; readonly reason: DetachReason }
>;

// The evidence rule in types: a reason exists only for a refusal or an uncertain outcome, and retryable is true
// exactly for the two states in which the recipient provably cannot hold the command.
export type CommandOutcome =
  | {
      readonly state: "engine_refused";
      readonly reason: CommandRefusalReason;
      readonly retryable: false;
    }
  | {
      readonly state: "uncertain";
      readonly reason: CommandUncertainReason;
      readonly retryable: false;
    }
  | { readonly state: "not confirmed" | "not delivered: never_sent"; readonly retryable: true }
  | {
      readonly state:
        | "queued"
        | "transport_confirmed"
        | "engine_dispatched"
        | "engine_applied"
        | "engine_stale";
      readonly retryable: false;
    };
export type CommandStateEvent = EventOf<
  "session.command_state",
  { readonly command_id: string; readonly receipt?: JsonObject } & CommandOutcome
>;
export type ReadEntry =
  | { readonly kind: "entry"; readonly entry_id: string; readonly entry: JsonValue }
  | {
      readonly kind: "entry_ref";
      readonly entry_id: string;
      readonly bytes: number;
      readonly sha256: string;
    };
export type ReadResult = EventOf<
  "session.read_result",
  {
    readonly attach: string;
    readonly query_id: string;
    readonly entries: readonly ReadEntry[];
    readonly next_before: string | null;
  }
>;
export type UploadAbort = EventOf<
  "session.upload_abort",
  { readonly upload_id: string; readonly reason: UploadAbortReason }
>;

export type LocalEvent =
  | StatusChanged
  | SessionsRound
  | ListingBegin
  | ListingRows
  | ListingEnd
  | SessionSnapshot
  | SnapshotLoading
  | SessionRecords
  | BlobOpen
  | BlobChunk
  | BlobDone
  | BlobAbort
  | AttachPending
  | Detached
  | CommandStateEvent
  | ReadResult
  | UploadAbort;
export type EventKind = LocalEvent["kind"];
