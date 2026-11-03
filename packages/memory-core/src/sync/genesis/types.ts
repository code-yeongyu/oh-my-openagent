import type { WrapEntry } from "../crypto/entry.ts"
import type { Principal, RecoveryKey } from "../crypto/parse.ts"
import type { WrapAddress } from "../recovery/key-material.ts"

export type GenesisBootstrap = {
  readonly account: string
  readonly custody_nonce: string
  readonly first_device: Principal
  readonly recovery_key: RecoveryKey
}

export type GenesisBody = {
  readonly kind: "genesis"
  readonly account: string
  readonly epoch: 1
  readonly bootstrap: GenesisBootstrap
  readonly custody_root: string
  readonly countersign: string
  readonly wraps_digest: string
}

export type GenesisPrepared = {
  readonly body: GenesisBody
  readonly wraps: readonly [WrapEntry, WrapEntry]
}

export type GenesisAppend = {
  readonly record: GenesisBody
  readonly base_seq: 0
  readonly link: string
  readonly keyring_link: string
  readonly record_sig: string
  readonly wraps: readonly [WrapEntry, WrapEntry]
}

export type GenesisCountersignPayload = {
  readonly t: "omo-sync/v1/recovery-countersign"
  readonly account: string
  readonly custody_root: string
  readonly predecessor: ""
  readonly wraps_digest: string
}

/**
 * Native-owned capabilities for one genesis operation. Both seals use the same fresh K1,
 * epoch 1 and empty history, with independent history nonces and HPKE encapsulations.
 * The owner disposes K1, PRF output and recovery private keys in finally, even on rejection.
 * Only public addresses, keys, ciphertext and signatures cross this boundary.
 */
export interface GenesisCapabilities {
  seal(address: WrapAddress, sealingPublicKey: string): Promise<string>
  /** Ed25519 over ASCII(payload.t) || NUL || JCS(payload), never unframed JSON. */
  countersign(payload: GenesisCountersignPayload): Promise<string>
}

export class GenesisBuildError extends Error {
  override readonly name = "GenesisBuildError"
  constructor(readonly reason: "bad_bootstrap" | "bad_record" | "principal_mismatch" | "account_mismatch" | "bad_wrap_set" | "bad_custody_root" | "wraps_digest_mismatch" | "bad_countersign" | "bad_signature") {
    super(`genesis: ${reason}`)
  }
}
