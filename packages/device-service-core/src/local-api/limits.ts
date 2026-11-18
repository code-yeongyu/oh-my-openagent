// Vendored from sisyphuslabs/omo-relay-daemon@edd2ee496fc5b4166f23c4d1cbfb4ed5b9099bb6 packages/local-api/src/limits.ts
import { createHash } from "node:crypto";
import { toBase64 } from "./bytes-encoding.ts";
import { SESSION_BLOB_MAX } from "./spec-proto.ts";

// A payload whose line would exceed LOCAL_INLINE_MAX bytes never goes on one line: it travels as a blob of chunks of
// at most LOCAL_CHUNK_MAX raw bytes (base64 in `b`), every chunk but the last exactly that size.
export const LOCAL_INLINE_MAX = 524_288;
export const LOCAL_CHUNK_MAX = 262_144;
// A local blob is the JSON re-encoding of a value that crossed the transport as canonical CBOR of at most
// SESSION_BLOB_MAX bytes; no CBOR byte becomes more than 6 JSON bytes (a control character becomes \u00XX).
export const LOCAL_JSON_EXPANSION_MAX = 6;
export const LOCAL_BLOB_MAX = LOCAL_JSON_EXPANSION_MAX * SESSION_BLOB_MAX;
// #1123: an uploaded machine.batch is at most what the transport reassembles toward the target device, 64 parts of
// 60,000 bytes: 3,840,000 bytes of ops JSON, so 15 local parts. One fs.write of about 2.87 MB of raw bytes fits; the
// sender still refuses a batch whose canonical form passes the same bound. Written out (not imported) so the bundled
// client's spec shim stays the public-safe set; relayd's MLA4 checks it equals the spec's parts bound.
export const MACHINE_UPLOAD_MAX_BYTES = 3_840_000;
export const MACHINE_UPLOAD_PARTS_MAX = Math.ceil(MACHINE_UPLOAD_MAX_BYTES / LOCAL_CHUNK_MAX);
// #1127: machine uploads one connection may hold at once (begun, not yet taken by a final): 4 x 3,840,000 bytes bounds
// what one connection makes the service hold at 15,360,000 bytes.
export const MACHINE_UPLOADS_OPEN_MAX = 4;
const grouped = (n: number): string => n.toLocaleString("en-US");
export const MACHINE_UPLOAD_LIMIT = `an uploaded batch is at most ${grouped(MACHINE_UPLOAD_MAX_BYTES)} bytes (${MACHINE_UPLOAD_PARTS_MAX} parts of ${grouped(LOCAL_CHUNK_MAX)} bytes)`;

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
      b: toBase64(data.subarray(off, off + LOCAL_CHUNK_MAX)),
    });
  return chunks;
};
