// The joining device's half of the pairing ceremony (sync-design section 7): commit to its keys and
// a fresh nonce, wait for an approver's answer, reveal, show the 6-digit code, then accept as its
// admission only the approval that the paired approver signed over this ceremony's transcript. The
// verified chain from genesis through that approval becomes the device's trust pin.

import { pairingAnchor } from "../crypto/anchor.ts"
import { isObject, type Principal } from "../crypto/parse.ts"
import { createRejectionCounter } from "../crypto/rejection.ts"
import { pinTrustAnchor } from "../crypto/trust-pin.ts"
import type { DeviceKeyring } from "../keyring-port.ts"
import { openAccountChain } from "./account-chain.ts"
import type { AccountHttp } from "./http.ts"
import { approvalCode, approvalCommitment, newPairingNonce } from "./pairing.ts"
import type { PairingHttp } from "./pairing-http.ts"

export interface CeremonyClock {
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}

export type JoinOutcome =
  | { readonly kind: "joined" }
  | { readonly kind: "expired" }
  | { readonly kind: "refused"; readonly reason: string }

export const POLL_MS = 2_000

export const principalOf = (keyring: DeviceKeyring): Principal => ({
  kind: "device",
  id: keyring.principal().id,
  sealing_public_key: keyring.publicKeys().sealing,
  signing_public_key: keyring.publicKeys().signing,
})

export async function joinAccount(input: {
  readonly account: string
  readonly keyring: DeviceKeyring
  readonly pinDir: string
  readonly chain: AccountHttp
  readonly pairing: PairingHttp
  readonly clock: CeremonyClock
  readonly showCode: (code: string) => void | Promise<void>
}): Promise<JoinOutcome> {
  const { account, keyring, chain, pairing, clock } = input
  const self = principalOf(keyring)
  const nonce = newPairingNonce()
  const commitment = await approvalCommitment(account, { principal: self, nonce })
  const opened = await pairing.openPending(account, commitment)
  let row = opened
  while (row.answer === null) {
    if (clock.now() >= opened.expires_at) return { kind: "expired" }
    await clock.sleep(POLL_MS)
    const next = await pairing.readPending(opened.id)
    if (next === null) return { kind: "expired" }
    row = next
  }
  const answer = row.answer
  await pairing.revealPending(opened.id, self, nonce)
  await input.showCode(await approvalCode(account, [{ principal: self, nonce }, { principal: answer.principal, nonce: answer.approver_nonce }]))
  const anchor = pairingAnchor({ account, keyring, approver: answer.principal, joiningNonce: nonce, approverNonce: answer.approver_nonce })
  for (;;) {
    const keys = await chain.listKeys()
    const admitted = keys?.some((entry) => {
      const principal = entry.body["principal"]
      return entry.body.kind === "approval" && isObject(principal) && principal["id"] === self.id
    }) === true
    if (admitted) {
      const walked = await openAccountChain({ account, anchor, keyring, http: chain, rejections: createRejectionCounter() })
      const pin = walked.state().pin
      if (!walked.state().anchored || pin === null) return { kind: "refused", reason: "the approval does not match this device's ceremony" }
      if (!walked.isMember() || (await walked.epochKey(walked.state().authority?.epoch ?? 0)) === null) {
        return { kind: "refused", reason: "the approval admits this device without a key it can open" }
      }
      await pinTrustAnchor(input.pinDir, account, pin)
      return { kind: "joined" }
    }
    if (clock.now() >= opened.expires_at) return { kind: "expired" }
    await clock.sleep(POLL_MS)
  }
}
