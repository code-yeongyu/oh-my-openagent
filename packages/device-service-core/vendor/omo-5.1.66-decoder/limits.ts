import { createHash } from "node:crypto";
import { SESSION_BLOB_MAX } from "./spec-proto.ts";

// A payload whose line would exceed LOCAL_INLINE_MAX bytes never goes on one line: it travels as a blob of chunks of
// at most LOCAL_CHUNK_MAX raw bytes (base64 in `b`), every chunk but the last exactly that size.
export const LOCAL_INLINE_MAX = 524_288;
export const LOCAL_CHUNK_MAX = 262_144;
// A local blob is the JSON re-encoding of a value that crossed the transport as canonical CBOR of at most
// SESSION_BLOB_MAX bytes; no CBOR byte becomes more than 6 JSON bytes (a control character becomes \u00XX).
export const LOCAL_JSON_EXPANSION_MAX = 6;
export const LOCAL_BLOB_MAX = LOCAL_JSON_EXPANSION_MAX * SESSION_BLOB_MAX;

const encoder = new TextEncoder();
export const lineBytes = (value: unknown): number =>
  encoder.encode(JSON.stringify(value)).length + 1;
export const sha256Hex = (data: Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

export const chunkPayload = (
  data: Uint8Array,
): readonly { readonly off: number; readonly b: string }[] => {
  const chunks: { readonly off: number; readonly b: string }[] = [];
  for (let off = 0; off < data.length; off += LOCAL_CHUNK_MAX)
    chunks.push({
      off,
      b: Buffer.from(data.subarray(off, off + LOCAL_CHUNK_MAX)).toString("base64"),
    });
  return chunks;
};
