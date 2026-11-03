import { LocalBlobAssembler } from "./chunking.ts";
import {
  ListingTracker,
  type ListingResult,
  type ListingRevision,
  type Settle,
} from "./client-listing.ts";
import { LocalApiError, protocolViolation } from "./errors.ts";
import type { BlobOpen, JsonValue, LocalEvent, ReadEntry, ReadResult } from "./protocol.ts";
import { validateSnapshotBlob } from "./validate.ts";
import { assertNever, InvalidMessage, jsonObject, jsonValue } from "./validate-fields.ts";

export type { ListingResult, ListingRevision } from "./client-listing.ts";
export type ReadPageEntry =
  | { readonly entry_id: string; readonly entry: JsonValue }
  | { readonly entry_id: string; readonly too_large: true; readonly bytes: number };
export type ReadPage = {
  readonly entries: readonly ReadPageEntry[];
  readonly next_before: string | null;
};

type EntryRef = Extract<ReadEntry, { readonly kind: "entry_ref" }>;
type ReadWatch = Settle<ReadPage> & {
  readonly attach: string;
  result: ReadResult | undefined;
  readonly filled: Map<string, ReadPageEntry>;
};

const parsed = (data: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError)
      return protocolViolation("a blob is not UTF-8 JSON");
    throw error;
  }
};
const checked = <T>(check: () => T): T => {
  try {
    return check();
  } catch (error) {
    if (error instanceof InvalidMessage) return protocolViolation(error.detail);
    throw error;
  }
};

// Turns the wire events into what a client applies: every event is passed on as it arrives, and a reassembled blob
// is passed on as the event it stands for (a snapshot, a record) or fills its history entry. Listing revisions and
// history pages are assembled for the callers that asked for them.
export class EventAssembler {
  readonly #emit: (event: LocalEvent) => void;
  readonly #blobs = new Map<string, LocalBlobAssembler>();
  readonly #listings = new ListingTracker();
  readonly #reads = new Map<string, ReadWatch>();

  constructor(emit: (event: LocalEvent) => void) {
    this.#emit = emit;
  }

  watchListing(
    query_id: string,
    settle: Settle<ListingResult>,
    onRevision?: (revision: ListingRevision) => void,
  ): void {
    this.#listings.watch(query_id, settle, onRevision);
  }

  watchRead(query_id: string, attach: string, settle: Settle<ReadPage>): void {
    this.#reads.set(query_id, { ...settle, attach, result: undefined, filled: new Map() });
  }

  failAll(error: LocalApiError): void {
    this.#listings.failAll(error);
    for (const watch of this.#reads.values()) watch.reject(error);
    this.#reads.clear();
  }

  accept(event: LocalEvent): void {
    this.#emit(event);
    switch (event.kind) {
      case "session.blob_open":
      case "session.blob_chunk":
      case "session.blob_done":
      case "session.blob_abort":
        return this.#blob(event.attach, event);
      case "sessions.listing_begin":
      case "sessions.listing_rows":
      case "sessions.listing_end":
      case "sessions.round":
        return this.#listings.accept(event);
      case "session.read_result":
        return this.#readResult(event);
      case "session.detached":
        return this.#detached(event.attach);
      case "status.changed":
      case "session.snapshot":
      case "session.snapshot_loading":
      case "session.records":
      case "session.attach_pending":
      case "session.command_state":
      case "session.upload_abort":
        return;
      default:
        return assertNever(event);
    }
  }

  #blob(
    attach: string,
    event: Extract<LocalEvent, { readonly kind: `session.blob_${string}` }>,
  ): void {
    const assembler = this.#blobs.get(attach) ?? new LocalBlobAssembler();
    this.#blobs.set(attach, assembler);
    const outcome = assembler.accept(event);
    if (outcome === undefined) return;
    switch (outcome.kind) {
      case "blob":
        return this.#apply(attach, outcome.open, outcome.data);
      case "aborted":
        if (outcome.open.of === "entry")
          this.#failRead(outcome.open.position.query_id, "an entry blob was aborted");
        return;
      case "too_large":
        return this.#fill(outcome.query_id, outcome.entry_id, (ref) => ({
          entry_id: ref.entry_id,
          too_large: true,
          bytes: ref.bytes,
        }));
      default:
        return assertNever(outcome);
    }
  }

  #apply(attach: string, open: BlobOpen, data: Uint8Array): void {
    const value = parsed(data);
    switch (open.of) {
      case "state": {
        const body = validateSnapshotBlob(value);
        if (body.attach_id !== open.position.attach_id)
          protocolViolation("a snapshot blob of another attach generation");
        return this.#emit({ type: "event", kind: "session.snapshot", attach, ...body });
      }
      case "record": {
        const records = [checked(() => jsonObject(value, "record"))];
        return this.#emit({
          type: "event",
          kind: "session.records",
          attach,
          attach_id: open.position.attach_id,
          records,
        });
      }
      case "entry": {
        const entry = checked(() => jsonValue(value, "entry"));
        return this.#fill(open.position.query_id, open.position.entry_id, (ref) =>
          ref.bytes === open.bytes && ref.sha256 === open.sha256
            ? { entry_id: ref.entry_id, entry }
            : protocolViolation("an entry blob unlike its entry_ref"),
        );
      }
      default:
        return assertNever(open);
    }
  }

  #fill(query_id: string, entry_id: string, make: (ref: EntryRef) => ReadPageEntry): void {
    const watch = this.#reads.get(query_id);
    if (watch === undefined) return;
    if (watch.result === undefined)
      return protocolViolation("an entry blob before its read_result");
    const ref = watch.result.entries.find((e) => e.kind === "entry_ref" && e.entry_id === entry_id);
    if (ref === undefined || ref.kind !== "entry_ref")
      return protocolViolation("a blob for an entry the page did not reference");
    watch.filled.set(entry_id, make(ref));
    this.#finishRead(query_id, watch);
  }

  #readResult(event: ReadResult): void {
    const watch = this.#reads.get(event.query_id);
    if (watch === undefined) return;
    watch.result = event;
    this.#finishRead(event.query_id, watch);
  }

  #finishRead(query_id: string, watch: ReadWatch): void {
    const result = watch.result;
    if (result === undefined) return;
    const entries: ReadPageEntry[] = [];
    for (const entry of result.entries) {
      const filled =
        entry.kind === "entry"
          ? { entry_id: entry.entry_id, entry: entry.entry }
          : watch.filled.get(entry.entry_id);
      if (filled === undefined) return;
      entries.push(filled);
    }
    this.#reads.delete(query_id);
    watch.resolve({ entries, next_before: result.next_before });
  }

  #failRead(query_id: string, reason: string): void {
    const watch = this.#reads.get(query_id);
    if (watch === undefined) return;
    this.#reads.delete(query_id);
    watch.reject(new LocalApiError("read_failed", reason));
  }

  #detached(attach: string): void {
    this.#blobs.delete(attach);
    for (const [query_id, watch] of this.#reads)
      if (watch.attach === attach) this.#failRead(query_id, "the attach was detached");
  }
}
