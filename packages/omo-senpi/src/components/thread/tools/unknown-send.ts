import type { AddressEntry } from "../address-book"
import { threadToolFailure } from "../errors"
import type { GatewayResolution } from "../gateway/engine"
import { claimedRowProof } from "./row-liveness"

/** Called only after scoped resolution, and before the gateway writes a receipt or queues a delivery. */
export function refuseUnanswered(book: readonly AddressEntry[], resolved: GatewayResolution): GatewayResolution {
  if (resolved.kind !== "ok" || resolved.target.refusal || resolved.target.liveness === "routable") return resolved
  const entry = book.find(
    (e) => e.thread_id === resolved.target.durable_id && e.source_host === resolved.target.endpoint?.socket,
  )
  if (!entry) return resolved
  const { liveness } = claimedRowProof("inactive", entry)
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
        thread: entry.thread_id,
        retry: true,
      },
    ),
  }
}
