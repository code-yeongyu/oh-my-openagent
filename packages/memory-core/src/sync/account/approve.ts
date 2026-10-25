// The approving member's half of the pairing ceremony (sync-design section 7): answer a pending
// pairing with this device's keys and a fresh nonce, require the joining device's reveal to match
// the commitment it opened with, show the 6-digit code, and only after the person confirms the
// codes match, append the approval that wraps the current epoch key to the new device.

import { createRejectionCounter } from "../crypto/rejection.ts"
import { wrapSetDigest } from "../crypto/links.ts"
import { loadTrustAnchor } from "../crypto/trust-pin.ts"
import type { DeviceKeyring } from "../keyring-port.ts"
import { sealWrap } from "../recovery/key-material.ts"
import { ownMaterial, signedAppend } from "../recovery/keyring-append.ts"
import { committedWrap, expectedHistory } from "../recovery/served-chain.ts"
import { openAccountChain } from "./account-chain.ts"
import type { AccountHttp } from "./http.ts"
import { type CeremonyClock, POLL_MS, principalOf } from "./join.ts"
import { approvalCode, approvalCommitment, newPairingNonce } from "./pairing.ts"
import type { PairingHttp } from "./pairing-http.ts"

export type ApproveOutcome =
  | { readonly kind: "approved"; readonly seq: number }
  | { readonly kind: "expired" }
  | { readonly kind: "declined" }
  | { readonly kind: "refused"; readonly reason: string }

export async function approveDevice(input: {
  readonly account: string
  readonly keyring: DeviceKeyring
  readonly pinDir: string
  readonly chain: AccountHttp
  readonly pairing: PairingHttp
  readonly clock: CeremonyClock
  readonly pendingId: string
  readonly confirmCode: (code: string) => Promise<boolean>
}): Promise<ApproveOutcome> {
  const { account, keyring, chain, pairing, clock } = input
  const pin = await loadTrustAnchor(input.pinDir, account)
  if (!pin.ok) return { kind: "refused", reason: "this device has not joined the account's memory" }
  const self = principalOf(keyring)
  const nonce = newPairingNonce()
  const answered = await pairing.answerPending(input.pendingId, self, nonce)
  let row = answered
  while (row.reveal === null) {
    if (clock.now() >= answered.expires_at) return { kind: "expired" }
    await clock.sleep(POLL_MS)
    const next = await pairing.readPending(input.pendingId)
    if (next === null) return { kind: "expired" }
    row = next
  }
  const joining = row.reveal
  if ((await approvalCommitment(account, { principal: joining.principal, nonce: joining.joining_nonce })) !== answered.commitment) {
    return { kind: "refused", reason: "the joining device revealed keys its commitment did not name" }
  }
  if (!(await input.confirmCode(await approvalCode(account, [{ principal: self, nonce }, { principal: joining.principal, nonce: joining.joining_nonce }])))) {
    return { kind: "declined" }
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const verified = await openAccountChain({ account, anchor: pin.anchor, keyring, http: chain, rejections: createRejectionCounter() })
    const state = verified.state()
    const authority = state.authority
    if (authority === null || state.head === null || !verified.isMember()) return { kind: "refused", reason: "this device is not a member of the account's memory" }
    const wrap = committedWrap(state, authority.epoch, `device:${self.id}`)
    const material = wrap === null ? null : await ownMaterial(keyring, account, wrap, expectedHistory(authority, authority.epoch))
    if (material === null) return { kind: "refused", reason: "this device cannot open the current epoch key" }
    const wraps = [await sealWrap({ account, epoch: authority.epoch, id: `device:${joining.principal.id}` }, joining.principal.sealing_public_key, material)]
    const digest = await wrapSetDigest(wraps)
    if (!digest.ok) return { kind: "refused", reason: "the approval wraps do not digest" }
    const body = {
      kind: "approval",
      account,
      epoch: authority.epoch,
      principal: { ...joining.principal },
      wraps_digest: digest.digest,
      pairing: { commitment: answered.commitment, joining_nonce: joining.joining_nonce, approver_nonce: nonce },
    }
    const appended = await chain.appendKeys(await signedAppend(keyring, state.head, body, wraps))
    if (appended.ok) return { kind: "approved", seq: appended.seq }
    if (appended.reason !== "stale_base") return { kind: "refused", reason: `the service refused the approval (${appended.reason})` }
  }
  return { kind: "refused", reason: "the account kept changing while approving; try again" }
}

