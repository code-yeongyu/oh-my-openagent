export const NUDGE_STATE_VERSION = 1

export const NUDGE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

export type NudgeDecisionOutcome = "none" | "snoozed" | "never" | "migrated"

export type NudgeState = {
  readonly schemaVersion: number
  readonly autoShows: number
  readonly lastShownAt: number | null
  readonly nextEligibleAt: number
  readonly decision: NudgeDecisionOutcome
  readonly decidedAt: number | null
  readonly writtenBy: string
}

export type NudgeStateRead = NudgeState | "missing" | "corrupt"
