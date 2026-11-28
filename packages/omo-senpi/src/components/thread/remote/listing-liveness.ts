import type { RemoteSessionRow } from "./ports"
import { remoteLiveness, rowProof } from "../tools/row-liveness"
import { rowState } from "../tools/thread-state"
import type { ThreadHostView } from "../tools/ports"

export type HostCounts = { readonly answered: number; readonly unanswered: number }

export function hostCountsFor(
  counts: Readonly<Record<string, unknown>> | undefined,
  device: string,
): HostCounts | null {
  const v = counts && Object.hasOwn(counts, device) ? counts[device] : undefined
  if (!v || typeof v !== "object" || !("answered" in v) || !("unanswered" in v)) return null
  const { answered, unanswered } = v
  return typeof answered === "number" &&
    Number.isSafeInteger(answered) &&
    answered >= 0 &&
    typeof unanswered === "number" &&
    Number.isSafeInteger(unanswered) &&
    unanswered >= 0
    ? { answered, unanswered }
    : null
}

const answeredListing = (host: ThreadHostView["hosts"][number]): boolean => {
  const reply = host.list_sessions ?? host.result
  return (
    host.error === undefined &&
    host.alive !== false &&
    reply !== undefined &&
    !("kind" in reply && reply.kind === "error")
  )
}

// A host known dead (its socket gone or refusing) holds no thread, so it is in neither count, as it never makes the
// listing incomplete (#14308).
export function countHostAnswers(view: ThreadHostView): HostCounts {
  const answered = view.hosts.filter(answeredListing).length
  const unanswered = view.hosts.filter((host) => !answeredListing(host) && host.reason !== "dead").length
  return { answered, unanswered }
}

export function listingProof(row: RemoteSessionRow) {
  return rowProof(rowState(row), row.source === "cache" ? undefined : remoteLiveness(row.liveness))
}
