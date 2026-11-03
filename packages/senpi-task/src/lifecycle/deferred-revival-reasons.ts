/** Deferral reasons a resumed session retries for its own child (omo#9498). */
export const SCOPED_RETRY_REASONS: ReadonlySet<string> = new Set([
  "capacity", "lock_contended", "model_unavailable", "session_unavailable",
  "rollback_failed", "foreign_live_owner",
])

/** Retried reasons that end the child as lost once the retries are spent; the others wait for the other side. */
export const LOST_ON_EXHAUSTION: ReadonlySet<string> = new Set([
  "model_unavailable", "session_unavailable", "rollback_failed", "lock_contended",
])

export const PERMANENT_REVIVAL_REASONS: ReadonlySet<string> = new Set([
  "host_incompatible", "spawn_spec_unavailable", "transcript_unavailable", "isolated_not_revivable",
])

/**
 * Every parked child of a live parent is recovered or ended by live-parent-recovery.
 * A permanent refusal bypasses the budget, including on a daemon-hosted child.
 */
export type DeferralOutlook = "recovering" | "ending"

export function deferralOutlookFor(reason: string, _hostSession: boolean): DeferralOutlook {
  return PERMANENT_REVIVAL_REASONS.has(reason) ? "ending" : "recovering"
}
