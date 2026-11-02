import { protocolViolation } from "./errors.ts";
import { chunkPayload, LOCAL_BLOB_MAX, LOCAL_CHUNK_MAX, sha256Hex } from "./limits.ts";
import type { BlobAbort, BlobChunk, BlobDone, BlobOpen, BlobTarget } from "./protocol.ts";
import { assertNever } from "./validate-fields.ts";

export * from "./limits.ts";
export { pageListing } from "./listing.ts";
export { checkCommandText, UploadAssembler, uploadParts } from "./upload.ts";

export const blobEvents = (
  attach: string,
  id: string,
  target: BlobTarget,
  data: Uint8Array,
): readonly (BlobOpen | BlobChunk | BlobDone)[] => {
  const open: BlobOpen = {
    type: "event",
    kind: "session.blob_open",
    attach,
    id,
    bytes: data.length,
    sha256: sha256Hex(data),
    ...target,
  };
  const chunks = chunkPayload(data).map(({ off, b }): BlobChunk => ({
    type: "event",
    kind: "session.blob_chunk",
    attach,
    id,
    off,
    b,
  }));
  return [open, ...chunks, { type: "event", kind: "session.blob_done", attach, id }];
};

export type BlobOutcome =
  | { readonly kind: "blob"; readonly open: BlobOpen; readonly data: Uint8Array }
  | { readonly kind: "aborted"; readonly open: BlobOpen; readonly reason: string }
  | { readonly kind: "too_large"; readonly query_id: string; readonly entry_id: string };

// One attach's reassembly: one blob in flight, chunks in order, sha256 checked at blob_done. A too_large abort answers
// a history fetch: it needs no open blob and leaves one in flight untouched.
export class LocalBlobAssembler {
  #open: BlobOpen | undefined;
  #parts: Uint8Array[] = [];
  #received = 0;

  inFlight(): boolean {
    return this.#open !== undefined;
  }

  accept(event: BlobOpen | BlobChunk | BlobDone | BlobAbort): BlobOutcome | undefined {
    switch (event.kind) {
      case "session.blob_open":
        if (this.#open !== undefined) return protocolViolation("one blob in flight per attach");
        if (event.bytes > LOCAL_BLOB_MAX) return protocolViolation("blob over LOCAL_BLOB_MAX");
        this.#open = event;
        return undefined;
      case "session.blob_chunk": {
        const open = this.#current(event.id);
        const data = Buffer.from(event.b, "base64");
        const end = this.#received + data.length;
        if (event.off !== this.#received || end > open.bytes)
          return protocolViolation("blob chunk out of order");
        if (data.length !== LOCAL_CHUNK_MAX && end !== open.bytes)
          return protocolViolation("short blob chunk");
        this.#parts.push(new Uint8Array(data));
        this.#received = end;
        return undefined;
      }
      case "session.blob_done": {
        const open = this.#current(event.id);
        if (this.#received !== open.bytes)
          return protocolViolation("blob done before its last chunk");
        const data = new Uint8Array(open.bytes);
        let at = 0;
        for (const part of this.#parts) {
          data.set(part, at);
          at += part.length;
        }
        this.#reset();
        return sha256Hex(data) === open.sha256
          ? { kind: "blob", open, data }
          : protocolViolation("blob digest mismatch");
      }
      case "session.blob_abort": {
        if (event.reason === "too_large")
          return { kind: "too_large", query_id: event.query_id, entry_id: event.entry_id };
        const open = this.#current(event.id);
        this.#reset();
        return { kind: "aborted", open, reason: event.reason };
      }
      default:
        return assertNever(event);
    }
  }

  #current(id: string): BlobOpen {
    const open = this.#open;
    return open !== undefined && open.id === id ? open : protocolViolation("blob not open");
  }

  #reset(): void {
    this.#open = undefined;
    this.#parts = [];
    this.#received = 0;
  }
}
