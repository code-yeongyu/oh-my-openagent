// One memory space's sync session for a signed-in device: the HTTP transport plus the Verifier and
// Sealer over this device's verified view of the account chain. A device that never paired or
// recovered (no trust pin), or that the verified chain does not list as a member, gets a typed idle
// reason instead of a session, so the runner stays idle without any network write.

import { loadTrustAnchor } from "../crypto/trust-pin.ts"
import { createRejectionCounter } from "../crypto/rejection.ts"
import { createHttpTransport } from "../engine/adapters/http-transport.ts"
import type { SyncSession } from "../engine/open.ts"
import type { DeviceKeyring } from "../keyring-port.ts"
import { openAccountChain } from "./account-chain.ts"
import { createAccountHttp } from "./http.ts"
import { createChainSealer } from "./sealer.ts"
import { createChainVerifier } from "./verifier.ts"

export type AccountSessionIdle = "no_pin" | "corrupt_pin" | "not_member"

export type AccountSessionOutcome =
  | { readonly ok: true; readonly session: SyncSession }
  | { readonly ok: false; readonly reason: AccountSessionIdle }

export interface AccountSessionOptions {
  readonly baseUrl: string
  readonly token: () => string | Promise<string>
  readonly account: string
  readonly keyring: DeviceKeyring
  /** Where this device keeps its trust pins (one per account), outside every memory repository. */
  readonly pinDir: string
  /** The memory space this session syncs (sync-design section 3), 16 bytes. */
  readonly spaceId: Uint8Array
  /** This device's CRDT peer id, carried in each batch header. */
  readonly peer?: () => string
  readonly fetch?: typeof fetch
  readonly log?: (line: string) => void
  readonly now?: () => number
}

export async function openAccountSession(options: AccountSessionOptions): Promise<AccountSessionOutcome> {
  if (options.spaceId.length !== 16) throw new TypeError("openAccountSession: a space id is 16 bytes")
  const pin = await loadTrustAnchor(options.pinDir, options.account)
  if (!pin.ok) return { ok: false, reason: pin.reason }
  const http = createAccountHttp({ baseUrl: options.baseUrl, token: options.token, ...(options.fetch === undefined ? {} : { fetch: options.fetch }) })
  const rejections = createRejectionCounter(options.log)
  const chain = await openAccountChain({ account: options.account, anchor: pin.anchor, keyring: options.keyring, http, rejections })
  if (!chain.isMember()) return { ok: false, reason: "not_member" }
  return {
    ok: true,
    session: {
      transport: createHttpTransport({ baseUrl: options.baseUrl, token: options.token, ...(options.fetch === undefined ? {} : { fetch: options.fetch }) }),
      verifier: createChainVerifier({ chain, spaceId: options.spaceId, rejections }),
      sealer: createChainSealer({ chain, keyring: options.keyring, spaceId: options.spaceId, ...(options.peer === undefined ? {} : { peer: options.peer }), ...(options.now === undefined ? {} : { now: options.now }) }),
    },
  }
}
