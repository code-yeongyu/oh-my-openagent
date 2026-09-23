import {
  NUDGE_AUTO_SHOW_CAP,
  NUDGE_CORRUPT_RECOVERY_MS,
  NUDGE_INTERVALS_MS,
  NUDGE_STATE_VERSION,
  type NudgeDecision,
  type NudgeDecisionInput,
  type NudgeState,
  type NudgeSuppressionReason,
} from "./types"

function freshState(now: number, version: string): NudgeState {
  return {
    schemaVersion: NUDGE_STATE_VERSION,
    autoShows: 0,
    lastShownAt: null,
    nextEligibleAt: now,
    decision: "none",
    decidedAt: null,
    writtenBy: version,
  }
}

function recoveredState(now: number, version: string): NudgeState {
  return { ...freshState(now, version), nextEligibleAt: now + NUDGE_CORRUPT_RECOVERY_MS }
}

function shownState(previous: NudgeState, now: number, version: string): NudgeState {
  const autoShows = previous.autoShows + 1
  const interval = NUDGE_INTERVALS_MS[Math.min(autoShows - 1, NUDGE_INTERVALS_MS.length - 1)] ?? 0
  return {
    ...previous,
    schemaVersion: NUDGE_STATE_VERSION,
    autoShows,
    lastShownAt: now,
    nextEligibleAt: now + interval,
    writtenBy: version,
  }
}

export function decideNativeEditionNudge(input: NudgeDecisionInput): NudgeDecision {
  const deny = (reason: NudgeSuppressionReason, nextState: NudgeState | null = null): NudgeDecision =>
    ({ show: false, reason, nextState })

  // A recorded opt-out or a completed migration outranks every other field, so a corrupted or
  // hand-edited state file can never resurrect a nudge the user already dismissed for good.
  if (input.state !== "missing" && input.state !== "corrupt") {
    if (input.state.decision === "never") return deny("opted-out")
    if (input.state.decision === "migrated") return deny("already-migrated")
  }

  if (input.nativeEditionInstalled) return deny("already-migrated")
  if (input.hookDisabled) return deny("opted-out")
  if (!input.interactive) return deny("non-interactive")
  if (input.childSession) return deny("child-session")
  if (input.shownThisProcess) return deny("already-shown-this-process")
  if (!input.toastAvailable) return deny("toast-unavailable")

  // Probe writability before showing: a nudge that cannot record itself would reappear every
  // session, which is the nagging failure mode this whole module exists to avoid.
  if (!input.stateWritable) return deny("state-unwritable")

  if (input.state === "corrupt") return deny("state-corrupt-recovering", recoveredState(input.now, input.version))

  const current = input.state === "missing" ? freshState(input.now, input.version) : input.state
  if (current.autoShows >= NUDGE_AUTO_SHOW_CAP) return deny("lifetime-cap-reached")
  if (input.now < current.nextEligibleAt) return deny("not-yet-eligible")

  return { show: true, reason: "eligible", nextState: shownState(current, input.now, input.version) }
}

export function snoozedState(previous: NudgeState, now: number, version: string, snoozeMs: number): NudgeState {
  return { ...previous, nextEligibleAt: now + snoozeMs, decision: "snoozed", decidedAt: now, writtenBy: version }
}

export function decidedState(
  previous: NudgeState,
  now: number,
  version: string,
  decision: "never" | "migrated",
): NudgeState {
  return { ...previous, decision, decidedAt: now, writtenBy: version }
}
