import type { TrustAnchor } from "../crypto/anchor.ts"
import { createRejectionCounter, type RejectionCounter } from "../crypto/rejection.ts"
import { loadTrustAnchor } from "../crypto/trust-pin.ts"
import { servedPhraseHints } from "./phrase-hints.ts"
import type { RecoveryTransport } from "./ports.ts"
import { servedSaltInputs } from "./salt-inputs.ts"
import { loadServedChain } from "./served-chain.ts"

export type PinnedMembership =
  | { readonly ok: true; readonly member: boolean }
  | { readonly ok: false; readonly reason: "unavailable" | "unverified" | "pin-conflict" }

/**
 * Whether `deviceId` is a member of the account's chain as walked from the device's own pinned anchor: the
 * predicate enable uses (D12 section 1, membership guard). A walk refused because the served genesis is not the pinned
 * one (the anchor check calls it an untrusted root) is a pin conflict; every other failed walk keeps its reason.
 * The genesis digest only labels a refusal the walk already made.
 */
export const pinnedMembership = async (
  transport: RecoveryTransport,
  account: string,
  rejections: RejectionCounter,
  anchor: TrustAnchor,
  deviceId: string,
): Promise<PinnedMembership> => {
  const served = await loadServedChain(transport, account, rejections, anchor)
  if (!served.ok) {
    if (served.reason === "unavailable") return { ok: false, reason: "unavailable" }
    const keys = await transport.listKeys()
    const genesis = Array.isArray(keys) ? keys[0]?.digest : undefined
    const conflict = served.reason === "anchor-mismatch" || (genesis !== undefined && genesis !== anchor.genesisDigest)
    return { ok: false, reason: conflict ? "pin-conflict" : "unverified" }
  }
  return { ok: true, member: served.state.authority?.members.has(deviceId) === true }
}

export type RecoveryMethod = "passkey" | "phrase" | "both" | "none"
export type RecoveryStatus =
  { readonly method: RecoveryMethod; readonly member: boolean } | { readonly blocked: "pin-corrupt" | "pin-conflict" }

const methodOf = (passkeys: number, phrases: number): RecoveryMethod => {
  if (passkeys > 0 && phrases > 0) return "both"
  if (passkeys > 0) return "passkey"
  return phrases > 0 ? "phrase" : "none"
}

/**
 * The status reading of the recovery entry (D12 section 1): the enrolled methods and the membership guard's
 * pre-begin reading. A pin that does not load or names another genesis is `blocked`, a lasting state Settings shows
 * with its repair step; a transient read failure is null, so the desktop hides the entry until the next read. The
 * guard itself still decides. The keyring is read once, and the walk counts rejections on its own counter so a
 * status poll never moves the counter recovery and sync share.
 */
export const readRecoveryStatus = async (input: {
  readonly transport: RecoveryTransport
  readonly account: string
  readonly stateDir: string
  readonly deviceId: string
}): Promise<RecoveryStatus | null> => {
  const pin = await loadTrustAnchor(input.stateDir, input.account)
  if (!pin.ok && pin.reason === "corrupt_pin") return { blocked: "pin-corrupt" }
  const keys = input.transport.listKeys()
  const transport: RecoveryTransport = { ...input.transport, listKeys: () => keys }
  let member = false
  if (pin.ok) {
    const read = await pinnedMembership(transport, input.account, createRejectionCounter(), pin.anchor, input.deviceId)
    if (!read.ok) return read.reason === "pin-conflict" ? { blocked: "pin-conflict" } : null
    member = read.member
  }
  const [salts, hints] = await Promise.all([servedSaltInputs(transport), servedPhraseHints(transport)])
  if (!salts.ok || !hints.ok) return null
  return { method: methodOf(salts.salts.length, hints.hints.length), member }
}
