import type { AddressBookHost, AddressEntry } from "../address-book"
import { threadToolFailure } from "../errors"
import type { GatewayResolution } from "../gateway/engine"
import { claimedRowProof } from "./row-liveness"
import type { ListedOwner } from "./send-view"

/**
 * Called only after scoped resolution, and before the gateway writes a receipt or queues a delivery. A thread whose
 * claiming host did not answer is unknown (contract row 29), so a send to it is refused instead of queued offline.
 */
export function refuseUnanswered(
  book: readonly AddressEntry[],
  resolved: GatewayResolution,
  owner?: ListedOwner,
): GatewayResolution {
  if (resolved.kind !== "ok" || resolved.target.refusal || resolved.target.liveness === "routable") return resolved
  const thread = resolved.target.durable_id
  const claim =
    book.find((e) => e.thread_id === thread && e.source_host === resolved.target.endpoint?.socket) ??
    (owner?.thread === thread ? ownerClaim(owner.host) : undefined)
  if (!claim) return resolved
  const { liveness } = claimedRowProof("inactive", claim)
  if (liveness?.kind !== "unknown" || liveness.reason !== "host_not_answering") return resolved
  return {
    kind: "error",
    error: threadToolFailure(
      "host_unavailable",
      "The host claiming this thread did not answer.",
      "The message was not stored. Retry the same send when the host answers.",
      {
        reason: liveness.reason,
        host: liveness.host,
        thread,
        retry: true,
      },
    ),
  }
}

/**
 * A published owner is listed on its own socket only (`sendView`), so its thread's file is found with no claiming host.
 * The owner's socket claims it: a failure other than a dead socket is a host that did not answer, as `thread_list` reads
 * it. An identity refusal is the owner refusal's (`withOwnerRefusal`), which resolution already carries.
 */
const ownerClaim = (host: AddressBookHost) => ({
  source_host: host.socket,
  host_unanswered: host.error !== undefined && host.reason !== "dead" && host.reason !== "identity_unproven",
})
