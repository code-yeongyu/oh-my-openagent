// Turning memory sync on for this device. The account and device switches go on first. An account
// whose keyring is empty has no members yet: its first device creates the keyring together with
// the recovery passkey (genesis requires one), so a device without a passkey bridge cannot start
// it. A device that already holds a pin and membership is on; any other device joins by pairing.

import { createRejectionCounter } from "../crypto/rejection.ts"
import { loadTrustAnchor } from "../crypto/trust-pin.ts"
import type { DeviceKeyring } from "../keyring-port.ts"
import { openAccountChain } from "./account-chain.ts"
import type { AccountHttp } from "./http.ts"
import type { PairingHttp } from "./pairing-http.ts"

export type EnableOutcome =
  | { readonly kind: "joined" }
  | { readonly kind: "join_required" }
  | { readonly kind: "needs_first_device" }

export async function enableSync(input: {
  readonly account: string
  readonly serviceDeviceId: string
  readonly keyring: DeviceKeyring
  readonly pinDir: string
  readonly chain: AccountHttp
  readonly pairing: PairingHttp
}): Promise<EnableOutcome> {
  await input.pairing.setAccountSync(true)
  await input.pairing.setDeviceSync(input.serviceDeviceId, true)
  const keys = await input.chain.listKeys()
  if (keys === null || keys.length === 0) return { kind: "needs_first_device" }
  const pin = await loadTrustAnchor(input.pinDir, input.account)
  if (!pin.ok) return { kind: "join_required" }
  const chain = await openAccountChain({ account: input.account, anchor: pin.anchor, keyring: input.keyring, http: input.chain, rejections: createRejectionCounter() })
  return chain.isMember() ? { kind: "joined" } : { kind: "join_required" }
}
