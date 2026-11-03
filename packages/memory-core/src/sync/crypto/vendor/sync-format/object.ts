/**
 * The OMOB object of docs/sync-design.md section 8: `OMOB` magic, a 1.x version word, a canonical
 * JSON header, the STREAM ciphertext (deflate-raw under AES-256-GCM with counter nonces and a
 * last-segment flag, AAD = SHA-256 of the header) and the author's Ed25519 signature. Reading is
 * staged and typed: every failure names its stage, and no failure yields partial plaintext.
 */

import { parseFrame } from "./frame.ts";
import { asciiBytes, sha256 } from "./jcs.ts";
import { verifyFramedBytes } from "./keys.ts";
import {
  fail,
  type ObjectContext,
  type ObjectFailure,
  type ObjectFailureReason,
  type ObjectSuccess,
  type ParsedFrame,
  type SyncObjectHeader,
} from "./object-types.ts";
import { parseRecords, streamOpen } from "./stream.ts";

export type {
  ObjectContext,
  ObjectFailure,
  ObjectFailureReason,
  ObjectSuccess,
  SyncObjectHeader,
  SyncObjectRecord,
} from "./object-types.ts";

const checkContext = (frame: ParsedFrame, ctx: ObjectContext): ObjectFailureReason | null => {
  if (frame.header.account_id !== ctx.account) return "account_mismatch";
  if (frame.header.epoch !== ctx.epoch) return "epoch_mismatch";
  // Objects are signed by devices only; a recovery author never writes a batch or a chunk.
  const { author } = frame.header;
  if (author.kind !== "device" || author.id !== ctx.authorId) return "author_mismatch";
  return null;
};

const verifySignature = async (
  bytes: Uint8Array<ArrayBuffer>,
  frame: ParsedFrame,
  ctx: ObjectContext,
): Promise<boolean> => {
  const unsigned = bytes.subarray(0, bytes.length - 64);
  const digest = await sha256(unsigned);
  return verifyFramedBytes(
    "omo-sync/v1/object-digest",
    digest,
    ctx.authorSigningPublicKey,
    frame.signature,
  );
};

/** Parses the frame, checks the context bindings and the author's signature; never decrypts. */
export const verifyObject = async (
  bytes: Uint8Array<ArrayBuffer>,
  ctx: ObjectContext,
): Promise<{ readonly ok: true; readonly header: SyncObjectHeader } | ObjectFailure> => {
  const frame = parseFrame(bytes);
  if ("reason" in frame) return frame;
  const binding = checkContext(frame, ctx);
  if (binding !== null) return fail(binding);
  const signed = await verifySignature(bytes, frame, ctx);
  return signed ? { ok: true, header: frame.header } : fail("bad_signature");
};

/**
 * Full read: frame, context bindings, signature, and - when the context carries the epoch key -
 * the STREAM decryption and payload records. The context is required: no object reads as ok
 * before its signature verified. A failure at any stage yields no partial plaintext.
 */
export const decodeObject = async (
  bytes: Uint8Array<ArrayBuffer>,
  ctx: ObjectContext,
): Promise<ObjectSuccess | ObjectFailure> => {
  const frame = parseFrame(bytes);
  if ("reason" in frame) return frame;
  const binding = checkContext(frame, ctx);
  if (binding !== null) return fail(binding);
  if (!(await verifySignature(bytes, frame, ctx))) return fail("bad_signature");
  if (ctx.epochKey === undefined) {
    return { ok: true, header: frame.header, signature: frame.signature, records: [] };
  }
  const payload = await streamOpen(frame, ctx.epochKey);
  if ("reason" in payload) return payload;
  const records = parseRecords(payload);
  if ("reason" in records) return records;
  return { ok: true, header: frame.header, signature: frame.signature, records };
};

/** The 4-byte magic every version-1 object starts with, exported for peeking readers. */
export const OBJECT_MAGIC = asciiBytes("OMOB");
