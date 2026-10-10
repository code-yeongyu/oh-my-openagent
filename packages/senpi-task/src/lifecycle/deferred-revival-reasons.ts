/** Deferral reasons a resumed session retries for its own child (omo#9498). */
export const SCOPED_RETRY_REASONS: ReadonlySet<string> = new Set([
  "capacity", "lock_contended", "model_unavailable", "session_unavailable",
  "rollback_failed", "foreign_live_owner",
])

/** Retried reasons that end the child as lost once the retries are spent; the others wait for the other side. */
export const LOST_ON_EXHAUSTION: ReadonlySet<string> = new Set([
  "model_unavailable", "session_unavailable", "rollback_failed", "lock_contended",
])

/**
 * What happens next to a child whose revival was deferred for `reason`; `hostSession` is true for a
 * daemon-hosted child, which the retry never marks lost.
 */
export type DeferralOutlook = "waits_for_capacity" | "may_stay_with_live_owner" | "retried_then_lost" | "retried_not_lost" | "not_retried"

export function deferralOutlookFor(reason: string, hostSession: boolean): DeferralOutlook {
  if (reason === "capacity") return "waits_for_capacity"
  if (reason === "foreign_live_owner") return "may_stay_with_live_owner"
  if (hostSession && (reason === "host_unreachable" || reason === "host_draining")) return "retried_not_lost"
  if (LOST_ON_EXHAUSTION.has(reason)) return hostSession ? "retried_not_lost" : "retried_then_lost"
  return "not_retried"
}
