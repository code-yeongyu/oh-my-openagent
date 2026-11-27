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

export function countHostAnswers(view: ThreadHostView): HostCounts {
  const answered = view.hosts.filter(
    (host) =>
      host.error === undefined &&
      host.alive !== false &&
      (host.list_sessions !== undefined || host.result !== undefined),
  ).length
  return { answered, unanswered: view.hosts.length - answered }
}

export function listingProof(row: RemoteSessionRow) {
  return rowProof(rowState(row), row.source === "cache" ? undefined : remoteLiveness(row.liveness))
}
