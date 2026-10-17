/**
 * The chain entries of docs/sync-design.md sections 7 and 8.2 and the record-signature checks: the
 * signed preimage, and the key an author is authorized with at a folded position. A principal the
 * folded membership no longer holds (a rotated-out signer) authorizes nothing after it.
 */
import { b64urlDecode, b64urlEncode, type JsonValue, SyncFormatError } from "./jcs.ts";
import { verifyFramed } from "./keys.ts";

export type SyncPrincipal = {
  readonly kind: "device";
  readonly id: string;
  readonly sealing_public_key: string;
  readonly signing_public_key: string;
};

/** Section 8.1's RecoveryAuthor: allowed only as the author of a recovery-join. */
export type SyncRecoveryAuthor = { readonly kind: "recovery"; readonly credential_id: string };

export type SyncRecoveryKey = {
  readonly credential_id: string;
  readonly rp_id: string;
  readonly enrollment_nonce: string;
  readonly sealing_public_key: string;
  readonly signing_public_key: string;
  readonly survivable: "synced" | "roaming";
};

export type RecordRef = {
  readonly seq: number;
  readonly digest: string;
  readonly keyring_link: string;
};

export type WrapEntry = { readonly epoch: number; readonly id: string; readonly wrap: string };

/** The merged authority a fork-resolution states (section 8.2). */
export type ForkState = {
  readonly members: ReadonlyArray<SyncPrincipal>;
  readonly recovery_keys: ReadonlyArray<SyncRecoveryKey>;
  readonly epoch: number;
};

export type ForkEvidence = {
  readonly common: RecordRef;
  readonly branches: ReadonlyArray<{
    readonly tip: RecordRef;
    readonly records: ReadonlyArray<ChainEntry>;
  }>;
};

/** The record bodies the fold reads, with the fields each kind needs present. */
export type KeyringBody = {
  readonly kind: string;
  readonly account: string;
  readonly epoch: number;
  readonly bootstrap?: {
    readonly first_device: SyncPrincipal;
    readonly recovery_key: SyncRecoveryKey;
  };
  readonly principal?: SyncPrincipal;
  readonly credential_id?: string;
  readonly members?: ReadonlyArray<SyncPrincipal>;
  readonly join_digest?: string;
  readonly wraps_digest?: string;
  readonly custody_root?: string;
  readonly countersign?: string;
  readonly merged_digest?: string;
  readonly fork_set?: ReadonlyArray<RecordRef>;
  readonly evidence?: ForkEvidence;
  readonly state?: ForkState;
};

/** One chain entry (a keyring record or a batch's signed envelope) as the transport carries it. */
export type ChainEntry = {
  readonly seq: number;
  readonly base_seq: number;
  readonly kind: "batch" | "keyring";
  readonly account: string;
  readonly epoch: number;
  readonly author: SyncPrincipal | SyncRecoveryAuthor;
  readonly body?: KeyringBody | null;
  readonly digest: string;
  readonly link: string;
  readonly keyring_link?: string | null;
  readonly record_sig: string;
  /** A KeyringEntry row's wrap set; its order is checked by the receiver. */
  readonly wraps?: ReadonlyArray<WrapEntry>;
};

/** The folded authority at a chain position: who may sign, and every enrolled recovery key. */
export type AuthorityFold = {
  readonly members: ReadonlyMap<string, SyncPrincipal>;
  readonly registry: ReadonlyMap<string, SyncRecoveryKey>;
  /** Digests of keyring records a veto cancelled; their descendants carry no authority. */
  readonly cancelled: ReadonlySet<string>;
};

/**
 * The signed preimage of an entry's record_sig. A batch omits keyring_link (never signs null in
 * its place); a keyring entry without one is malformed and refused with a SyncFormatError.
 */
export const recordPreimage = (entry: ChainEntry): JsonValue => {
  const link = entry.keyring_link;
  if (entry.kind === "keyring" && (link === null || link === undefined)) {
    throw new SyncFormatError("missing_keyring_link", "a keyring entry signs its keyring_link");
  }
  return {
    t: "omo-sync/v1/record",
    account: entry.account,
    base_seq: entry.base_seq,
    digest: entry.digest,
    epoch: entry.epoch,
    link: entry.link,
    ...(entry.kind === "keyring" && typeof link === "string" ? { keyring_link: link } : {}),
  };
};

export type EntryAuthorization =
  | { readonly ok: true; readonly signingPublicKey: Uint8Array<ArrayBuffer> }
  | { readonly ok: false; readonly reason: "not_member" | "bad_base64url" };

/**
 * The signing key an entry's author is authorized with at the folded position: a device's own
 * registered key, or the enrolled recovery signing key named by a recovery author's credential
 * id. Absent from the fold (a rotated-out signer, a removed credential) authorizes nothing.
 */
export const entryAuthorKey = (
  fold: AuthorityFold,
  author: ChainEntry["author"],
): EntryAuthorization => {
  const b64 =
    author.kind === "recovery"
      ? fold.registry.get(author.credential_id)?.signing_public_key
      : fold.members.get(author.id)?.signing_public_key;
  if (b64 === undefined) return { ok: false, reason: "not_member" };
  try {
    const keyBytes = b64urlDecode(b64);
    return keyBytes.length === 32
      ? { ok: true, signingPublicKey: keyBytes }
      : { ok: false, reason: "bad_base64url" };
  } catch {
    return { ok: false, reason: "bad_base64url" };
  }
};

/** Verifies one entry's record_sig at its own position; any malformed field reads as false. */
export const verifyEntrySignature = async (
  fold: AuthorityFold,
  entry: ChainEntry,
): Promise<boolean> => {
  const key = entryAuthorKey(fold, entry.author);
  if (!key.ok) return false;
  try {
    return await verifyFramed(
      "omo-sync/v1/record",
      recordPreimage(entry),
      key.signingPublicKey,
      b64urlDecode(entry.record_sig),
    );
  } catch (error) {
    if (error instanceof SyncFormatError) return false;
    throw error;
  }
};

/** Links hash raw 32-byte digests, never their text: prior link bytes then the digest bytes. */
export const linkDigestPair = (priorLink: string, digest: string): Uint8Array<ArrayBuffer> => {
  const prior = b64urlDecode(priorLink);
  const current = b64urlDecode(digest);
  return new Uint8Array([...prior, ...current]);
};

export const b64url = b64urlEncode;
