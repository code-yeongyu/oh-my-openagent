// Vendored from sisyphuslabs/omo-relay-daemon@edd2ee496fc5b4166f23c4d1cbfb4ed5b9099bb6 packages/local-api/src/upload.ts
import { fromBase64 } from "./bytes-encoding.ts";
import { ProtoError } from "./spec-proto.ts";
import {
  COMMAND_TEXT_MAX_BYTES,
  COMMAND_TEXT_MAX_CHARS,
  validateCommandText,
} from "./command-text.ts";
import { chunkPayload, LOCAL_CHUNK_MAX } from "./limits.ts";
import type { UploadAbortReason } from "./protocol.ts";

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

// Uploads carry the UTF-8 text of a prompt or steer in session.command_part messages; the text is checked against
// the engine's own limit with the command text check in command-text.ts.
export const MESSAGE_LIMIT_CHARS = COMMAND_TEXT_MAX_CHARS;
export const LOCAL_UPLOAD_PARTS_MAX = Math.ceil(COMMAND_TEXT_MAX_BYTES / LOCAL_CHUNK_MAX);
// #1127: a refused upload's id is kept so its later parts and its final answer the refusal; at most this many ids per
// assembler, the oldest forgotten first, so a long-lived connection whose senders never send a final holds no more.
export const REFUSED_UPLOADS_KEPT = 64;

export const checkCommandText = (value: string): "ok" | "message_too_long" | "malformed" => {
  try {
    validateCommandText(value);
    return "ok";
  } catch (error) {
    if (error instanceof ProtoError)
      return error.code === "payload_too_large" ? "message_too_long" : "malformed";
    throw error;
  }
};

export type UploadPart = {
  readonly upload_id: string;
  readonly index: number;
  readonly count: number;
  readonly b: string;
};

export const uploadParts = (value: string): readonly Omit<UploadPart, "upload_id">[] => {
  const chunks = chunkPayload(new TextEncoder().encode(value));
  return chunks.map(({ b }, index) => ({ index, count: chunks.length, b }));
};

export type PartVerdict =
  | { readonly kind: "accepted"; readonly complete: boolean }
  | { readonly kind: "refused"; readonly reason: UploadAbortReason };
export type TakeResult =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "refused"; readonly reason: UploadAbortReason }
  | { readonly kind: "incomplete" };
export type TakeBytesResult =
  | { readonly kind: "bytes"; readonly bytes: Uint8Array }
  | Exclude<TakeResult, { readonly kind: "text" }>;

type Upload = { readonly count: number; readonly parts: Map<number, Uint8Array>; bytes: number };

// The owner's side: parts by index, every part but the last exactly LOCAL_CHUNK_MAX bytes; a repeated index with
// other bytes, or another count, refuses the whole upload parts_conflict, and more than maxBytes held refuses it
// message_too_long (a command's text by default; an uploaded machine batch passes its own bound).
export class UploadAssembler {
  readonly #uploads = new Map<string, Upload>();
  readonly #refused = new Map<string, UploadAbortReason>();
  readonly #maxBytes: number;

  constructor(maxBytes: number = COMMAND_TEXT_MAX_BYTES) {
    this.#maxBytes = maxBytes;
  }

  accept(part: UploadPart): PartVerdict {
    const refused = this.#refused.get(part.upload_id);
    if (refused !== undefined) return { kind: "refused", reason: refused };
    const data = fromBase64(part.b);
    const upload = this.#uploads.get(part.upload_id) ?? {
      count: part.count,
      parts: new Map(),
      bytes: 0,
    };
    const problem = this.#problem(upload, part, data);
    if (problem !== undefined) return this.#refuse(part.upload_id, problem);
    if (!upload.parts.has(part.index)) {
      upload.parts.set(part.index, data);
      upload.bytes += data.length;
    }
    this.#uploads.set(part.upload_id, upload);
    if (upload.bytes > this.#maxBytes) return this.#refuse(part.upload_id, "message_too_long");
    return { kind: "accepted", complete: upload.parts.size === upload.count };
  }

  // The upload's bytes in index order, once every part is in; the upload is released.
  takeBytes(uploadId: string): TakeBytesResult {
    const refused = this.#refused.get(uploadId);
    if (refused !== undefined) return { kind: "refused", reason: refused };
    const upload = this.#uploads.get(uploadId);
    if (upload === undefined || upload.parts.size !== upload.count) return { kind: "incomplete" };
    this.#uploads.delete(uploadId);
    const bytes = new Uint8Array(upload.bytes);
    let at = 0;
    for (let index = 0; index < upload.count; index += 1) {
      const part = upload.parts.get(index) ?? new Uint8Array(0);
      bytes.set(part, at);
      at += part.length;
    }
    return { kind: "bytes", bytes };
  }

  take(uploadId: string): TakeResult {
    const taken = this.takeBytes(uploadId);
    if (taken.kind !== "bytes") return taken;
    let value: string;
    try {
      value = new TextDecoder("utf-8", { fatal: true }).decode(taken.bytes);
    } catch (error) {
      if (error instanceof TypeError) return { kind: "refused", reason: "malformed" };
      throw error;
    }
    const verdict = checkCommandText(value);
    return verdict === "ok" ? { kind: "text", text: value } : { kind: "refused", reason: verdict };
  }

  // The part indexes an upload still waits for, with its count; undefined when no part of it is held.
  missing(
    uploadId: string,
  ): { readonly indexes: readonly number[]; readonly count: number } | undefined {
    const upload = this.#uploads.get(uploadId);
    if (upload === undefined) return undefined;
    const indexes = Array.from({ length: upload.count }, (_, i) => i).filter(
      (i) => !upload.parts.has(i),
    );
    return { indexes, count: upload.count };
  }

  // #1127: uploads held (begun and not yet taken), and whether an id is held or refused.
  held(): number {
    return this.#uploads.size;
  }

  knows(uploadId: string): boolean {
    return this.#uploads.has(uploadId) || this.#refused.has(uploadId);
  }

  /** #829 P3: uploads begun and not complete (an update's drain counts them as commands). */
  pending(): number {
    return [...this.#uploads.values()].filter((u) => u.parts.size < u.count).length;
  }

  discard(uploadId: string): void {
    this.#uploads.delete(uploadId);
    this.#refused.delete(uploadId);
  }

  #problem(upload: Upload, part: UploadPart, data: Uint8Array): UploadAbortReason | undefined {
    if (part.count !== upload.count) return "parts_conflict";
    if (part.index !== part.count - 1 && data.length !== LOCAL_CHUNK_MAX) return "malformed";
    const existing = upload.parts.get(part.index);
    if (existing !== undefined && !sameBytes(existing, data)) return "parts_conflict";
    return undefined;
  }

  #refuse(uploadId: string, reason: UploadAbortReason): PartVerdict {
    this.#uploads.delete(uploadId);
    this.#refused.delete(uploadId);
    this.#refused.set(uploadId, reason);
    for (const oldest of this.#refused.keys()) {
      if (this.#refused.size <= REFUSED_UPLOADS_KEPT) break;
      this.#refused.delete(oldest);
    }
    return { kind: "refused", reason };
  }
}
