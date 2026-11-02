/** The OMOB object's typed surface, shared by the frame, stream and object readers. */
export type SyncObjectHeader = {
  readonly account_id: string;
  readonly batch_id: string;
  readonly kind: "ops" | "snapshot";
  readonly epoch: number;
  readonly author: { readonly kind: string; readonly id: string };
  readonly peers: ReadonlyArray<string>;
  readonly salt: string;
  readonly chunk?: { readonly index: number; readonly count: number };
  readonly created_at: number;
};

/** One payload record: the item key travels only inside the ciphertext. */
export type SyncObjectRecord = {
  readonly type: number;
  readonly spaceId: Uint8Array<ArrayBuffer>;
  readonly itemKey: string;
  readonly body: Uint8Array<ArrayBuffer>;
};

export type ObjectFailureReason =
  | "bad_magic"
  | "unsupported_major"
  | "truncated"
  | "bad_header"
  | "account_mismatch"
  | "epoch_mismatch"
  | "author_mismatch"
  | "bad_signature"
  | "stream_aead"
  | "bad_payload"
  | "payload_too_large";

export type ObjectFailure = {
  readonly ok: false;
  readonly reason: ObjectFailureReason;
  readonly records?: undefined;
};

export type ObjectSuccess = {
  readonly ok: true;
  readonly header: SyncObjectHeader;
  readonly signature: Uint8Array<ArrayBuffer>;
  readonly records: ReadonlyArray<SyncObjectRecord>;
};

export type ObjectContext = {
  readonly account: string;
  readonly epoch: number;
  readonly authorId: string;
  readonly authorSigningPublicKey: Uint8Array<ArrayBuffer>;
  /** Present to decrypt; absent reads header and signature only. */
  readonly epochKey?: Uint8Array<ArrayBuffer>;
};

export type ParsedFrame = {
  readonly header: SyncObjectHeader;
  readonly headerBytes: Uint8Array<ArrayBuffer>;
  readonly ciphertext: Uint8Array<ArrayBuffer>;
  readonly signature: Uint8Array<ArrayBuffer>;
};

export const fail = (reason: ObjectFailureReason): ObjectFailure => ({ ok: false, reason });
