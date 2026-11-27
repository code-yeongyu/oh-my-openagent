/**
 * The STREAM payload: deflate-raw cut into 64 KiB segments, each AES-256-GCM sealed with an
 * 11-byte big-endian counter and a last-segment flag as nonce, AAD = SHA-256 of the header.
 */
import { asciiBytes, b64urlDecode, concatBytes, sha256 } from "./jcs.ts";
import { hkdfSha256 } from "./keys.ts";
import {
  fail,
  type ObjectFailure,
  type ParsedFrame,
  type SyncObjectHeader,
  type SyncObjectRecord,
} from "./object-types.ts";

const SEGMENT = 65536;
const TAG = 16;
const FULL_SEGMENT = SEGMENT + TAG;
const MIB = 1024 * 1024;

/** The plaintext ceiling per object kind (section 8): 8 MiB per batch, 64 MiB per snapshot chunk. */
export const PLAINTEXT_LIMIT: Readonly<Record<SyncObjectHeader["kind"], number>> = {
  ops: 8 * MIB,
  snapshot: 64 * MIB,
};

/**
 * Inflates deflate-raw segments, refusing as soon as the output passes `limit` (a small object
 * must not expand without bound). Every rejection of the stream - bad or truncated deflate, junk
 * after the final block, the cancel past the limit - becomes a typed failure for this object only;
 * none escapes as an unhandled rejection that would end the process.
 */
const inflateWithin = async (
  segments: ReadonlyArray<Uint8Array<ArrayBuffer>>,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | ObjectFailure> => {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const fed = (async () => {
    for (const segment of segments) await writer.write(segment);
    await writer.close();
  })().then(
    () => true,
    () => false,
  );
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        await fed;
        return fail("payload_too_large");
      }
      parts.push(value);
    }
  } catch {
    await fed;
    return fail("bad_payload");
  }
  return (await fed) ? concatBytes(parts) : fail("bad_payload");
};

const segmentNonce = (index: number, last: boolean): Uint8Array<ArrayBuffer> => {
  const nonce = new Uint8Array(12);
  const view = new DataView(nonce.buffer);
  view.setUint16(5, Math.floor(index / 4294967296), false);
  view.setUint32(7, index % 4294967296, false);
  nonce[11] = last ? 1 : 0;
  return nonce;
};

const openSegment = async (
  key: CryptoKey,
  aad: Uint8Array<ArrayBuffer>,
  index: number,
  last: boolean,
  segment: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer> | null> => {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: segmentNonce(index, last), additionalData: aad, tagLength: 128 },
      key,
      segment,
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
};

export const streamOpen = async (
  frame: ParsedFrame,
  epochKey: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer> | ObjectFailure> => {
  const batchKey = await hkdfSha256(
    epochKey,
    b64urlDecode(frame.header.salt),
    asciiBytes("omo-sync/v1/batch"),
  );
  const key = await crypto.subtle.importKey("raw", batchKey, "AES-GCM", false, ["decrypt"]);
  const aad = await sha256(frame.headerBytes);
  const segments: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (let index = 0; ; index += 1) {
    const remaining = frame.ciphertext.length - offset;
    if (remaining === 0) return fail("truncated");
    const last = remaining <= FULL_SEGMENT;
    if (remaining < TAG + 1) return fail("truncated");
    const length = last ? remaining : FULL_SEGMENT;
    const segment = frame.ciphertext.subarray(offset, offset + length);
    const plain = await openSegment(key, aad, index, last, segment);
    if (plain === null) {
      // A full-size final segment that opens as a middle segment is an authentic prefix whose
      // tail was cut at a segment boundary: a truncation, not a forgery.
      const prefix =
        last && length === FULL_SEGMENT ? await openSegment(key, aad, index, false, segment) : null;
      return fail(prefix === null ? "stream_aead" : "truncated");
    }
    segments.push(plain);
    offset += length;
    if (last) break;
  }
  return inflateWithin(segments, PLAINTEXT_LIMIT[frame.header.kind]);
};

/** Item keys are UTF-8 exactly: an invalid sequence is refused, never read as U+FFFD. */
const strictUtf8 = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
};

export const parseRecords = (
  payload: Uint8Array<ArrayBuffer>,
): ReadonlyArray<SyncObjectRecord> | ObjectFailure => {
  const records: SyncObjectRecord[] = [];
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let offset = 0;
  while (offset < payload.length) {
    if (payload.length - offset < 1 + 16 + 2 + 4) return fail("bad_payload");
    const type = payload[offset] ?? 0;
    if (type !== 1 && type !== 2 && type !== 3) return fail("bad_payload");
    const spaceId = payload.subarray(offset + 1, offset + 17);
    const keyLength = view.getUint16(offset + 17, false);
    const keyStart = offset + 19;
    if (payload.length - keyStart < keyLength + 4) return fail("bad_payload");
    const itemKey = strictUtf8(payload.subarray(keyStart, keyStart + keyLength));
    if (itemKey === null) return fail("bad_payload");
    const bodyLength = view.getUint32(keyStart + keyLength, false);
    const bodyStart = keyStart + keyLength + 4;
    if (payload.length - bodyStart < bodyLength) return fail("bad_payload");
    records.push({
      type,
      spaceId: new Uint8Array(spaceId),
      itemKey,
      body: new Uint8Array(payload.subarray(bodyStart, bodyStart + bodyLength)),
    });
    offset = bodyStart + bodyLength;
  }
  return records;
};
