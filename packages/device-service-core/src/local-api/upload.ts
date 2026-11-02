import {
  ProtoError,
  SESSION_COMMAND_TEXT_MAX_BYTES,
  SESSION_COMMAND_TEXT_MAX_CHARS,
  validateCommandText,
} from "./spec-proto.ts";
import { chunkPayload, LOCAL_CHUNK_MAX } from "./limits.ts";
import type { UploadAbortReason } from "./protocol.ts";

// Uploads carry the UTF-8 text of a prompt or steer in session.command_part messages; the text is checked against
// the engine's own limit with the shared command contract's validateCommandText.
export const MESSAGE_LIMIT_CHARS = SESSION_COMMAND_TEXT_MAX_CHARS;
export const LOCAL_UPLOAD_PARTS_MAX = Math.ceil(SESSION_COMMAND_TEXT_MAX_BYTES / LOCAL_CHUNK_MAX);

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

type Upload = { readonly count: number; readonly parts: Map<number, Uint8Array>; bytes: number };

// The owner's side: parts by index, every part but the last exactly LOCAL_CHUNK_MAX bytes; a repeated index with
// other bytes, or another count, refuses the whole upload parts_conflict.
export class UploadAssembler {
  readonly #uploads = new Map<string, Upload>();
  readonly #refused = new Map<string, UploadAbortReason>();

  accept(part: UploadPart): PartVerdict {
    const refused = this.#refused.get(part.upload_id);
    if (refused !== undefined) return { kind: "refused", reason: refused };
    const data = new Uint8Array(Buffer.from(part.b, "base64"));
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
    if (upload.bytes > SESSION_COMMAND_TEXT_MAX_BYTES)
      return this.#refuse(part.upload_id, "message_too_long");
    return { kind: "accepted", complete: upload.parts.size === upload.count };
  }

  take(uploadId: string): TakeResult {
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
    let value: string;
    try {
      value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      if (error instanceof TypeError) return { kind: "refused", reason: "malformed" };
      throw error;
    }
    const verdict = checkCommandText(value);
    return verdict === "ok" ? { kind: "text", text: value } : { kind: "refused", reason: verdict };
  }

  discard(uploadId: string): void {
    this.#uploads.delete(uploadId);
    this.#refused.delete(uploadId);
  }

  #problem(upload: Upload, part: UploadPart, data: Uint8Array): UploadAbortReason | undefined {
    if (part.count !== upload.count) return "parts_conflict";
    if (part.index !== part.count - 1 && data.length !== LOCAL_CHUNK_MAX) return "malformed";
    const existing = upload.parts.get(part.index);
    if (existing !== undefined && !Buffer.from(existing).equals(data)) return "parts_conflict";
    return undefined;
  }

  #refuse(uploadId: string, reason: UploadAbortReason): PartVerdict {
    this.#uploads.delete(uploadId);
    this.#refused.set(uploadId, reason);
    return { kind: "refused", reason };
  }
}
