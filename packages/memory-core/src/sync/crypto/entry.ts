import type { JsonValue } from "./vendor/sync-format/jcs.ts"

/** As the wire carries it: a device author is the full principal, a recovery author its credential. */
export type SyncAuthor =
  | {
      readonly kind: "device"
      readonly id: string
      readonly sealing_public_key: string
      readonly signing_public_key: string
    }
  | { readonly kind: "recovery"; readonly credential_id: string }

export type SyncRecordFields = {
  readonly account: string
  readonly base_seq: number
  readonly digest: string
  readonly epoch: number
  readonly link: string
  readonly keyring_link: string | null
}

export type KeyringBody = {
  readonly kind: string
  readonly account: string
  readonly epoch: number
  readonly [field: string]: JsonValue
}

export type WrapEntry = { readonly epoch: number; readonly id: string; readonly wrap: string }

declare const verifiedWrap: unique symbol

/**
 * A wrap whose source keyring entry passed every chain check, including its wrap-set rule, and the
 * account that entry was verified for. Only the local verified chain mints one (chain.ts); a wrap the
 * server served, copied or re-shaped is a plain WrapEntry and `openWrap` refuses it.
 */
export type VerifiedWrap = WrapEntry & { readonly account: string; readonly [verifiedWrap]: true }

export type KeyringEntry = SyncRecordFields & {
  readonly seq: number
  readonly kind: "keyring"
  readonly author: SyncAuthor
  readonly body: KeyringBody
  readonly keyring_link: string
  readonly record_sig: string
  readonly wraps: ReadonlyArray<WrapEntry>
}

export type BatchEntry = SyncRecordFields & {
  readonly seq: number
  readonly kind: "batch"
  readonly author: SyncAuthor
  readonly keyring_link: null
  readonly record_sig: string
}

export type SyncEntry = KeyringEntry | BatchEntry

export type VerifiedKeyringEntry = Omit<KeyringEntry, "wraps"> & { readonly wraps: ReadonlyArray<VerifiedWrap> }

export type Head = { readonly seq: number; readonly link: string; readonly keyring_link: string }
