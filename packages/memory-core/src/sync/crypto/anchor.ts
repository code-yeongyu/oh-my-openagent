import type { DeviceKeyring } from "../keyring-port.ts"
import type { KeyringEntry } from "./entry.ts"
import type { Authority } from "./fold.ts"
import { isObject, type ParsedBody, type Principal } from "./parse.ts"

declare const trustAnchorBrand: unique symbol
declare const pinCandidateBrand: unique symbol
declare const bootstrapBrand: unique symbol

/**
 * The account root this device pinned when its own pairing or recovery completed (sync-design
 * section 7: "no device key is trusted before this check passes"). Only the pin store mints one,
 * from the persisted pin file, so a caller cannot make one up from served data.
 */
export type TrustAnchor = {
  readonly kind: "pinned"
  readonly account: string
  readonly genesisDigest: string
  readonly [trustAnchorBrand]: true
}

export type PinSource = "pairing" | "recovery" | "creator"

type PublicKeys = { readonly sealing_public_key: string; readonly signing_public_key: string }

/**
 * Evidence a device holds before any pin exists, from its own ceremony, never from the server. Each
 * kind is a branded value only the mint functions below create, so a value of the right shape built
 * anywhere else is refused:
 * - pairing: this device's principal (read from its own keyring), the approver keys its 6-digit code
 *   covered, and both nonces (the approval rule recomputes the commitment from these keys and nonce);
 * - recovery: the recovery public keys this device derived from the passkey it is using;
 * - creator: this device's id, read from its own keyring. Only a genesis whose first device has that
 *   id meets it; genesis rules derive the id from the first device's signing key and verify the
 *   genesis signature under that key, so only the holder of this device's private key produced it.
 */
export type BootstrapAnchor = (
  | {
      readonly kind: "pairing"
      readonly account: string
      readonly self: Principal
      readonly approver: PublicKeys
      readonly transcript: { readonly joining_nonce: string; readonly approver_nonce: string }
    }
  | ({ readonly kind: "recovery"; readonly account: string; readonly credentialId: string } & PublicKeys)
  | { readonly kind: "creator"; readonly account: string; readonly selfId: string }
) & { readonly [bootstrapBrand]: true }

export type ChainAnchor = TrustAnchor | BootstrapAnchor

/** What a bootstrap walk proved, ready for the pin store; minted only by a walk that reached its anchor. */
export type PinCandidate = {
  readonly account: string
  readonly genesisDigest: string
  readonly pinnedBy: PinSource
  readonly at: { readonly seq: number; readonly keyring_link: string }
  readonly [pinCandidateBrand]: true
}

export type AnchorRejection = "untrusted_root" | "anchor_mismatch" | "unanchored"

/** The next step every anchor refusal carries: trust is re-established only by the user, never by the server. */
export const ANCHOR_NEXT_STEP = "re-pair or recover" as const

const anchors = new WeakSet<object>()
const candidates = new WeakSet<object>()
const bootstraps = new WeakSet<object>()

export const isBootstrapAnchor = (value: unknown): value is BootstrapAnchor => typeof value === "object" && value !== null && bootstraps.has(value)

const isBootstrap = (value: object): value is BootstrapAnchor => bootstraps.has(value)

const mintBootstrap = (value: object): BootstrapAnchor => {
  const frozen = Object.freeze(value)
  bootstraps.add(frozen)
  if (!isBootstrap(frozen)) throw new Error("unreachable: a fresh bootstrap anchor is always registered")
  return frozen
}

const principalOf = (keyring: DeviceKeyring): Principal => ({
  kind: "device",
  id: keyring.principal().id,
  sealing_public_key: keyring.publicKeys().sealing,
  signing_public_key: keyring.publicKeys().signing,
})

/** The anchor of the device that creates the account: its own id, from its own keyring. */
export const creatorAnchor = (account: string, keyring: DeviceKeyring): BootstrapAnchor =>
  mintBootstrap({ kind: "creator", account, selfId: keyring.principal().id })

/** The anchor of a joining device after its 6-digit code matched: its own principal, the approver keys and both nonces. */
export const pairingAnchor = (input: {
  readonly account: string
  readonly keyring: DeviceKeyring
  readonly approver: PublicKeys
  readonly joiningNonce: string
  readonly approverNonce: string
}): BootstrapAnchor => {
  const approver = Object.freeze({ sealing_public_key: input.approver.sealing_public_key, signing_public_key: input.approver.signing_public_key })
  const transcript = Object.freeze({ joining_nonce: input.joiningNonce, approver_nonce: input.approverNonce })
  return mintBootstrap({ kind: "pairing", account: input.account, self: Object.freeze(principalOf(input.keyring)), approver, transcript })
}

/** The anchor of a recovering device: the public keys it derived from the passkey it is using. */
export const recoveryAnchor = (input: { readonly account: string; readonly credentialId: string } & PublicKeys): BootstrapAnchor =>
  mintBootstrap({ kind: "recovery", account: input.account, credentialId: input.credentialId, sealing_public_key: input.sealing_public_key, signing_public_key: input.signing_public_key })

export const isTrustAnchor = (value: unknown): value is TrustAnchor => typeof value === "object" && value !== null && anchors.has(value)
export const isPinCandidate = (value: unknown): value is PinCandidate => typeof value === "object" && value !== null && candidates.has(value)

const isAnchor = (value: object): value is TrustAnchor => anchors.has(value)
const isCandidate = (value: object): value is PinCandidate => candidates.has(value)

/** Internal to the pin store (trust-pin.ts); not exported from the package. */
export const mintTrustAnchor = (account: string, genesisDigest: string): TrustAnchor => {
  const anchor = Object.freeze({ kind: "pinned" as const, account, genesisDigest })
  anchors.add(anchor)
  if (!isAnchor(anchor)) throw new Error("unreachable: a fresh trust anchor is always registered")
  return anchor
}

const mintCandidate = (account: string, genesisDigest: string, pinnedBy: PinSource, entry: KeyringEntry): PinCandidate => {
  const candidate = Object.freeze({ account, genesisDigest, pinnedBy, at: Object.freeze({ seq: entry.seq, keyring_link: entry.keyring_link }) })
  candidates.add(candidate)
  if (!isCandidate(candidate)) throw new Error("unreachable: a fresh pin candidate is always registered")
  return candidate
}

const sameKeys = (a: PublicKeys | undefined, b: PublicKeys): boolean =>
  a !== undefined && a.sealing_public_key === b.sealing_public_key && a.signing_public_key === b.signing_public_key

export type AnchorStep =
  | { readonly ok: true; readonly anchored: boolean; readonly candidate: PinCandidate | null }
  | { readonly ok: false; readonly reason: AnchorRejection }

/**
 * Applies the device's anchor to one fully verified keyring record. A pinned anchor is met at
 * genesis when its digest equals the pinned root and refuses any other root. Every other anchor must
 * be one the mint functions above created. A creator anchor is met only at a genesis whose first
 * device has this device's id; the rules already tied that id to the first device's signing key and
 * verified the genesis signature under it, so only this device can have produced it. A pairing anchor is
 * met by the approval naming this device's own principal, signed by the folded member whose keys are
 * the counterpart keys the device's 6-digit code hashed, carrying exactly the device's transcript
 * (the code binds both devices' keys and both nonces; spec section 7). The served commitment needs
 * no comparison here: the approval rule already recomputes it from the approval's principal keys and
 * joining nonce, which this check holds equal to the device's own. A recovery anchor is met by the record enrolling the credential in use
 * (genesis or its recovery-key record) when its public keys equal the locally derived ones; that
 * record's countersignature, already verified under its own key, then verifies under the derived
 * key too. A record that names this device or credential but contradicts the evidence refuses the
 * chain. `genesisDigest` is the digest at seq 1 of the chain being walked.
 */
export const anchorStep = (
  anchor: ChainAnchor,
  entry: KeyringEntry,
  body: ParsedBody,
  before: Authority | null,
  genesisDigest: string,
): AnchorStep => {
  if (anchor.kind === "pinned") {
    if (body.kind !== "genesis") return { ok: true, anchored: false, candidate: null }
    if (!isTrustAnchor(anchor)) return { ok: false, reason: "untrusted_root" }
    if (entry.digest !== anchor.genesisDigest) return { ok: false, reason: "untrusted_root" }
    return { ok: true, anchored: true, candidate: null }
  }
  if (!isBootstrapAnchor(anchor)) return { ok: false, reason: "untrusted_root" }
  if (anchor.kind === "creator") {
    if (body.kind !== "genesis") return { ok: true, anchored: false, candidate: null }
    const own = body.firstDevice.id === anchor.selfId
    return own ? { ok: true, anchored: true, candidate: mintCandidate(anchor.account, entry.digest, "creator", entry) } : { ok: false, reason: "anchor_mismatch" }
  }
  if (anchor.kind === "pairing") {
    if (body.kind !== "approval" || body.principal.id !== anchor.self.id) return { ok: true, anchored: false, candidate: null }
    const pairing = entry.body["pairing"]
    const transcript = isObject(pairing) ? pairing : {}
    const signer = entry.author.kind === "device" ? before?.members.get(entry.author.id) : undefined
    const matches =
      sameKeys(body.principal, anchor.self) &&
      sameKeys(signer, anchor.approver) &&
      transcript["joining_nonce"] === anchor.transcript.joining_nonce &&
      transcript["approver_nonce"] === anchor.transcript.approver_nonce
    return matches ? { ok: true, anchored: true, candidate: mintCandidate(anchor.account, genesisDigest, "pairing", entry) } : { ok: false, reason: "anchor_mismatch" }
  }
  const enrolled = body.kind === "genesis" ? body.recoveryKey : body.kind === "recovery-key" ? body.key : null
  if (enrolled === null || enrolled.credential_id !== anchor.credentialId) return { ok: true, anchored: false, candidate: null }
  return sameKeys(enrolled, anchor)
    ? { ok: true, anchored: true, candidate: mintCandidate(anchor.account, genesisDigest, "recovery", entry) }
    : { ok: false, reason: "anchor_mismatch" }
}
