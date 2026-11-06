/** The OMOB frame: magic, 1.x version word, canonical JSON header, ciphertext, signature. */
import { b64urlDecode } from "./jcs.ts";
import type { ObjectFailure, ParsedFrame, SyncObjectHeader } from "./object-types.ts";

const TAG = 16;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readKind = (value: unknown): "ops" | "snapshot" | null =>
  value === "ops" || value === "snapshot" ? value : null;

const readHeaderField = (header: Record<string, unknown>): SyncObjectHeader | null => {
  const accountId = header["account_id"];
  const batchId = header["batch_id"];
  const kind = readKind(header["kind"]);
  const epoch = header["epoch"];
  const author = header["author"];
  const peers = header["peers"];
  const salt = header["salt"];
  const createdAt = header["created_at"];
  if (typeof accountId !== "string" || accountId.length === 0) return null;
  if (typeof batchId !== "string") return null;
  try {
    if (b64urlDecode(batchId).length !== 16) return null;
  } catch {
    return null;
  }
  if (kind === null) return null;
  if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 1) return null;
  if (!isRecord(author)) return null;
  const authorKind = author["kind"];
  const authorId = author["id"];
  if (typeof authorKind !== "string" || typeof authorId !== "string") return null;
  if (!Array.isArray(peers)) return null;
  const peerList: string[] = [];
  for (const peer of peers) {
    if (typeof peer !== "string") return null;
    peerList.push(peer);
  }
  if (typeof salt !== "string") return null;
  try {
    if (b64urlDecode(salt).length !== 32) return null;
  } catch {
    return null;
  }
  if (typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt < 0) {
    return null;
  }
  const chunkValue: unknown = header["chunk"];
  const base = {
    account_id: accountId,
    batch_id: batchId,
    kind,
    epoch,
    author: { kind: authorKind, id: authorId },
    peers: peerList,
    salt,
    created_at: createdAt,
  };
  if (chunkValue === undefined) {
    return kind === "ops" ? base : null;
  }
  if (!isRecord(chunkValue)) return null;
  const index = chunkValue["index"];
  const count = chunkValue["count"];
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) return null;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 || index >= count) {
    return null;
  }
  return kind === "snapshot" ? { ...base, chunk: { index, count } } : null;
};

export const parseFrame = (bytes: Uint8Array<ArrayBuffer>): ParsedFrame | ObjectFailure => {
  if (bytes.length < 10 + 2 + TAG + 64) {
    return { ok: false, reason: "truncated" };
  }
  if (bytes[0] !== 0x4f || bytes[1] !== 0x4d || bytes[2] !== 0x4f || bytes[3] !== 0x42) {
    return { ok: false, reason: "bad_magic" };
  }
  if (bytes[4] !== 1) return { ok: false, reason: "unsupported_major" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(6, false);
  const frameEnd = 10 + headerLength;
  if (bytes.length < frameEnd + TAG + 64) return { ok: false, reason: "truncated" };
  const headerBytes = bytes.subarray(10, frameEnd);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(headerBytes));
  } catch {
    return { ok: false, reason: "bad_header" };
  }
  if (!isRecord(parsed)) return { ok: false, reason: "bad_header" };
  const header = readHeaderField(parsed);
  if (header === null) return { ok: false, reason: "bad_header" };
  return {
    header,
    headerBytes,
    ciphertext: bytes.subarray(frameEnd, bytes.length - 64),
    signature: bytes.subarray(bytes.length - 64),
  };
};
