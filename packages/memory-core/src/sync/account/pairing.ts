// The commit-then-reveal pairing ceremony's two hashes (sync-design section 7, Approval, and 8.1):
// the joining device's commitment fixes its keys and nonce before it sees the approver's, and both
// screens show one 6-digit code derived from both devices' keys and nonces. A relay that swaps a
// key cannot choose the hidden nonce, so a substitution matches with probability 10^-6.

import type { Principal } from "../crypto/parse.ts"
import { taggedHash } from "../crypto/signatures.ts"
import { b64urlDecode, b64urlEncode } from "../crypto/vendor/sync-format/jcs.ts"

export interface PairingParty {
  readonly principal: Principal
  readonly nonce: string
}

export const newPairingNonce = (): string => b64urlEncode(crypto.getRandomValues(new Uint8Array(16)))

export const approvalCommitment = (account: string, joining: PairingParty): Promise<string> =>
  taggedHash("omo-sync/v1/approval-commitment", {
    account,
    sealing_public_key: joining.principal.sealing_public_key,
    signing_public_key: joining.principal.signing_public_key,
    nonce: joining.nonce,
  })

const compareBytes = (left: Uint8Array, right: Uint8Array): number => {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

export async function approvalCode(account: string, parties: readonly [PairingParty, PairingParty]): Promise<string> {
  const devices = [...parties]
    .sort((a, b) => compareBytes(b64urlDecode(a.principal.signing_public_key), b64urlDecode(b.principal.signing_public_key)))
    .map((party) => ({ sealing_public_key: party.principal.sealing_public_key, signing_public_key: party.principal.signing_public_key, nonce: party.nonce }))
  const digest = b64urlDecode(await taggedHash("omo-sync/v1/approval-code", { account, devices }))
  return String(new DataView(digest.buffer, digest.byteOffset, digest.byteLength).getUint32(0) % 1_000_000).padStart(6, "0")
}
