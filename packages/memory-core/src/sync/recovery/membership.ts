import type { TrustAnchor } from "../crypto/anchor.ts"
import type { RejectionCounter } from "../crypto/rejection.ts"
import type { RecoveryTransport } from "./ports.ts"
import { loadServedChain } from "./served-chain.ts"

export type PinnedMembership =
  | { readonly ok: true; readonly member: boolean }
  | { readonly ok: false; readonly reason: "unavailable" | "unverified" | "pin-conflict" }

/**
 * Whether `deviceId` is a member of the account's chain as walked from the device's own pinned anchor: the
 * predicate enable uses (D12 section 1, membership guard). A walk refused because the served genesis is not the pinned
 * one (the anchor check calls it an untrusted root) is a pin conflict; every other failed walk keeps its reason.
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
    return { ok: false, reason: served.reason === "anchor-mismatch" ? "pin-conflict" : "unverified" }
  }
  return { ok: true, member: served.state.authority?.members.has(deviceId) === true }
}
