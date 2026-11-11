// The pure decisions of a freeze settle (sync-design section 7, rotation on revoke; #12280 design
// section 3.1). The settler reads the state, the verified chain and the device list; these functions
// decide, in the design's rule order, whether this device rotates and with which members. Nothing
// here performs I/O or opens a key.

import type { ChainState } from "../crypto/chain.ts"
import type { Head } from "../crypto/entry.ts"
import type { Authority } from "../crypto/fold.ts"
import type { Principal } from "../crypto/parse.ts"
import type { FreezeReason } from "../engine/ports.ts"
import type { RevocationView } from "./revocation-view.ts"

export type Gate =
  { readonly kind: "ok" } | { readonly kind: "not_member" } | { readonly kind: "frozen"; readonly reason: FreezeReason }

/** Rule 2: the verified chain reached exactly the head the state route served. */
export const atServedHead = (state: ChainState, served: Head): boolean =>
  state.head !== null &&
  state.authority !== null &&
  state.head.seq === served.seq &&
  state.head.link === served.link &&
  state.head.keyring_link === served.keyring_link

const DEDICATED: Readonly<Record<string, FreezeReason>> = {
  "recovery-join": "waiting_recovery",
  "recovery-join-vetoed": "waiting_unsupported_freeze",
  "fork-resolution": "waiting_unsupported_freeze",
}

/**
 * Rules 3 and 4, before any key is opened. A non-member yields with no reason (a session open across a
 * recovery-join that excluded it keeps its `not_member` seal failure). A freeze set by a recovery-join,
 * a veto or a fork-resolution needs a rotation this settler cannot build, so it waits.
 */
export function chainGate(state: ChainState, self: { readonly id: string; readonly signing: string }): Gate {
  if (state.authority?.members.get(self.id)?.signing_public_key !== self.signing) return { kind: "not_member" }
  const newest = state.history.at(-1)?.body.kind
  const reason = newest === undefined ? undefined : DEDICATED[newest]
  return reason === undefined ? { kind: "ok" } : { kind: "frozen", reason }
}

/** Rule 6, plus the view's own usability: the list must name this device, on a live row. */
export function viewGate(view: RevocationView, selfId: string): Gate {
  if (view.kind === "unusable" || view.self !== selfId) return { kind: "frozen", reason: "device_list_unusable" }
  return view.selfRevoked ? { kind: "frozen", reason: "self_revoked" } : { kind: "ok" }
}

/** What a process remembers about its last rotation, or its last refused append, for one account. */
export interface SettleMemory {
  readonly keyringLink: string
  readonly revoked: ReadonlySet<string>
}

const sameSet = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  left.size === right.size && [...left].every((id) => right.has(id))

/**
 * Rule 7 (and the bound after a refused append): append again only when the served keyring head
 * moved since `memory`, or the revoked set changed. Neither can be forged by a service, so a flag
 * kept set after every rotation buys one append per genuine new record or revoke.
 */
export const unchangedSince = (
  memory: SettleMemory | undefined,
  servedKeyringLink: string,
  revoked: ReadonlySet<string>,
): boolean => memory !== undefined && memory.keyringLink === servedKeyringLink && sameSet(memory.revoked, revoked)

/**
 * The rotation's member list: the folded membership minus every member on a revoked row. A member no
 * row names is kept and counted; the service's own register refuses a rotation that keeps a revoked key.
 */
export function rotationMembers(
  authority: Authority,
  view: RevocationView & { readonly kind: "usable" },
): { readonly members: ReadonlyArray<Principal>; readonly unlisted: number } {
  const members = [...authority.members.values()].filter((member) => !view.revoked.has(member.id))
  return { members, unlisted: members.filter((member) => !view.listed.has(member.id)).length }
}

/** The revoked set grew between two reads: a second revoke raced the first read. */
export const revokedGrew = (before: ReadonlySet<string>, after: RevocationView): boolean =>
  after.kind === "usable" && [...after.revoked].some((id) => !before.has(id))
