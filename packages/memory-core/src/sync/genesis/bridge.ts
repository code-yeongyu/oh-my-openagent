import type { Principal } from "../crypto/parse.ts"
import type { SyncOperationAuthority } from "../operation-authority.ts"
import type { GenesisPrepared } from "./types.ts"

export type GenesisBridgeRequest = {
  readonly account: string
  readonly rpId: string
  readonly userName: string
  readonly roaming: boolean
  readonly firstDevice: Principal
}

export type GenesisBridgeRefusal =
  | "cancelled" | "no-prf" | "no-user-verification" | "not-survivable"
  | "credential-reused" | "rp-mismatch" | "key-mismatch" | "unavailable"

export type GenesisBridgeResult =
  | { readonly ok: true; readonly prepared: GenesisPrepared }
  | { readonly ok: false; readonly reason: GenesisBridgeRefusal }

export interface GenesisBridge {
  readonly prfSupported: boolean
  createGenesis(request: GenesisBridgeRequest, options: { readonly operation: SyncOperationAuthority }): Promise<GenesisBridgeResult>
}

export class GenesisEnableError extends Error {
  override readonly name = "GenesisEnableError"
  constructor(readonly reason: "malformed_reply" | "incomplete_chain" | "unusable_key" | "intent_mismatch" | "corrupt_intent" | "missing_configuration" | "bridge_refused" | "append_refused", options?: ErrorOptions) {
    super(`first-device sync: ${reason}`, options)
  }
}
