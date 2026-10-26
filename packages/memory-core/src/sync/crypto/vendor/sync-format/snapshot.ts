/**
 * The signed snapshot envelope of docs/sync-design.md sections 6 and 8.3: its `record_sig`
 * preimage (which gains `author`, the registering device principal) and the importing device's
 * object-binding check against the chunk objects (section 6's ordered check 5 applied to every
 * chunk, plus index coverage and the digest rule).
 */

import type { AuthorityFold, ChainEntry } from "./chain.ts";
import { b64urlDecode, type JsonValue, SyncFormatError, sha256B64 } from "./jcs.ts";
import { verifyFramed } from "./keys.ts";
import { verifyObject } from "./object.ts";
import type { SyncObjectHeader } from "./object-types.ts";
import { receiveKeyringChain } from "./receive.ts";

/** The registering principal: a full device principal, so a served author swap fails the sig. */
export type SnapshotAuthor = {
  readonly kind: "device";
  readonly id: string;
  readonly sealing_public_key: string;
  readonly signing_public_key: string;
};

/** The snapshot row as `POST /v1/sync/compact` registers it and the state route returns it. */
export type SnapshotEnvelope = {
  readonly account: string;
  readonly author: SnapshotAuthor;
  readonly covers_seq: number;
  readonly digest: string;
  readonly link: string;
  readonly keyring_head: string;
  readonly record_sig: string;
};

/** The canonical JSON payload `record_sig` signs, every signed field listed. */
export const snapshotPreimage = (envelope: SnapshotEnvelope): JsonValue => ({
  t: "omo-sync/v1/snapshot",
  account: envelope.account,
  author: {
    kind: envelope.author.kind,
    id: envelope.author.id,
    sealing_public_key: envelope.author.sealing_public_key,
    signing_public_key: envelope.author.signing_public_key,
  },
  covers_seq: envelope.covers_seq,
  digest: envelope.digest,
  link: envelope.link,
  keyring_head: envelope.keyring_head,
});

/** `record_sig` verifies under the envelope's author, a member of the fold at covers_seq. */
export const verifySnapshot = async (
  fold: AuthorityFold,
  envelope: SnapshotEnvelope,
): Promise<boolean> => {
  const member = fold.members.get(envelope.author.id);
  if (member === undefined) return false;
  if (member.signing_public_key !== envelope.author.signing_public_key) return false;
  if (member.sealing_public_key !== envelope.author.sealing_public_key) return false;
  try {
    return await verifyFramed(
      "omo-sync/v1/snapshot",
      snapshotPreimage(envelope),
      b64urlDecode(envelope.author.signing_public_key),
      b64urlDecode(envelope.record_sig),
    );
  } catch (error) {
    if (error instanceof SyncFormatError) return false;
    throw error;
  }
};

export type SnapshotImport = {
  readonly snapshot: SnapshotEnvelope;
  /** The chunk objects exactly as pulled; any order, they are placed by their header index. */
  readonly chunks: ReadonlyArray<Uint8Array<ArrayBuffer>>;
  /** Keyring rows up to the snapshot's covers_seq, folding the membership at that point. */
  readonly entries: ReadonlyArray<ChainEntry>;
};

export type SnapshotImportFailureReason =
  | "snapshot_chain_refused"
  | "snapshot_keyring_head"
  | "snapshot_author_not_member"
  | "snapshot_bad_record_sig"
  | "snapshot_account"
  | "snapshot_epoch"
  | "snapshot_author_mismatch"
  | "snapshot_kind"
  | "snapshot_chunk_coverage"
  | "snapshot_digest";

export type SnapshotImportResult =
  | {
      readonly ok: true;
      /** Chunk headers in index order, every binding already checked. */
      readonly headers: ReadonlyArray<SyncObjectHeader>;
    }
  | { readonly ok: false; readonly reason: SnapshotImportFailureReason };

const fail = (reason: SnapshotImportFailureReason): SnapshotImportResult => ({ ok: false, reason });

/**
 * The importing device's check (section 8.3 steps 3-5): `keyring_head` equals the folded keyring
 * link at covers_seq, the envelope's `record_sig` under its
 * author, then section 6's step-5 object binding for every chunk - the chunk's signature verifies
 * under that author, the header's author and account equal it, the header's epoch is the epoch at
 * covers_seq (the newest genesis or rotation a veto did not cancel), the kind is snapshot, chunk {index, count} covers 0..count-1 exactly once, and the
 * digest recomputes from the chunk digests in index order.
 */
export const importSnapshot = async (input: SnapshotImport): Promise<SnapshotImportResult> => {
  const { snapshot, chunks, entries } = input;
  const atCovers = entries.filter((e) => e.seq <= snapshot.covers_seq);
  const received = await receiveKeyringChain(atCovers);
  if (!received.ok) return fail("snapshot_chain_refused");
  const { fold } = received;
  const keyringHead = atCovers.filter((e) => e.kind === "keyring").at(-1)?.keyring_link;
  if (keyringHead !== snapshot.keyring_head) return fail("snapshot_keyring_head");
  const member = fold.members.get(snapshot.author.id);
  if (member === undefined) return fail("snapshot_author_not_member");
  if (!(await verifySnapshot(fold, snapshot))) return fail("snapshot_bad_record_sig");
  const epoch = atCovers
    .filter((e) => !fold.cancelled.has(e.digest))
    .filter((e) => e.body?.kind === "genesis" || e.body?.kind === "rotation")
    .at(-1)?.epoch;
  if (epoch === undefined) return fail("snapshot_epoch");
  const ctx = {
    account: snapshot.account,
    epoch,
    authorId: snapshot.author.id,
    authorSigningPublicKey: b64urlDecode(snapshot.author.signing_public_key),
  };
  const headers: (SyncObjectHeader | undefined)[] = [];
  const digests: string[] = [];
  for (const chunk of chunks) {
    const verified = await verifyObject(chunk, ctx);
    if (!verified.ok) {
      if (verified.reason === "account_mismatch") return fail("snapshot_account");
      if (verified.reason === "epoch_mismatch") return fail("snapshot_epoch");
      if (verified.reason === "author_mismatch") return fail("snapshot_author_mismatch");
      return fail("snapshot_bad_record_sig");
    }
    const { header } = verified;
    const { chunk: placement } = header;
    if (header.kind !== "snapshot" || placement === undefined) {
      return fail("snapshot_kind");
    }
    const { index, count } = placement;
    if (count !== chunks.length) return fail("snapshot_chunk_coverage");
    if (headers[index] !== undefined) return fail("snapshot_chunk_coverage");
    headers[index] = header;
    digests[index] = await sha256B64(chunk);
  }
  const placed = headers.filter((header): header is SyncObjectHeader => header !== undefined);
  if (placed.length !== chunks.length) return fail("snapshot_chunk_coverage");
  const digest = await sha256B64(new Uint8Array(digests.flatMap((d) => [...b64urlDecode(d)])));
  if (digest !== snapshot.digest) return fail("snapshot_digest");
  return { ok: true, headers: placed };
};
