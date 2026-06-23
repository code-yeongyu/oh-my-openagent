import type { MeetingDecision, MeetingGateState } from "./types"

export interface MeetingSchedulerConfig {
  minHoursBetween: number
  maxHoursBetween: number
  minInboxDrafts: number
  idleThresholdMinutes: number
}

export const DEFAULT_MEETING_SCHEDULER_CONFIG: MeetingSchedulerConfig = {
  minHoursBetween: 4,
  maxHoursBetween: 24,
  minInboxDrafts: 3,
  idleThresholdMinutes: 5,
}

export function decideMeeting(
  state: MeetingGateState,
  config: MeetingSchedulerConfig = DEFAULT_MEETING_SCHEDULER_CONFIG,
  now: Date = new Date(),
): MeetingDecision {
  if (state.has_user_override) {
    return {
      should_hold: true,
      reason: "user override",
      suggested_drafts: state.inbox_draft_count,
    }
  }

  const hoursSinceLast = computeHoursSince(state.last_meeting_at, now)
  const idleMinutes = computeMinutesSince(state.idle_since, now)

  if (hoursSinceLast !== undefined && hoursSinceLast < config.minHoursBetween) {
    return {
      should_hold: false,
      reason: `too recent (${hoursSinceLast.toFixed(1)}h < ${config.minHoursBetween}h)`,
      suggested_drafts: state.inbox_draft_count,
    }
  }

  if (hoursSinceLast !== undefined && hoursSinceLast >= config.maxHoursBetween) {
    return {
      should_hold: true,
      reason: `overdue (${hoursSinceLast.toFixed(1)}h >= ${config.maxHoursBetween}h)`,
      suggested_drafts: state.inbox_draft_count,
    }
  }

  if (state.inbox_draft_count < config.minInboxDrafts) {
    return {
      should_hold: false,
      reason: `not enough drafts (${state.inbox_draft_count} < ${config.minInboxDrafts})`,
      suggested_drafts: state.inbox_draft_count,
    }
  }

  if (idleMinutes !== undefined && idleMinutes < config.idleThresholdMinutes) {
    return {
      should_hold: false,
      reason: `user active (idle ${idleMinutes.toFixed(1)}m < ${config.idleThresholdMinutes}m)`,
      suggested_drafts: state.inbox_draft_count,
    }
  }

  return {
    should_hold: true,
    reason: `criteria met (${state.inbox_draft_count} drafts, ${hoursSinceLast?.toFixed(1) ?? "∞"}h since last)`,
    suggested_drafts: state.inbox_draft_count,
  }
}

function computeHoursSince(iso: string | undefined, now: Date): number | undefined {
  if (!iso) return undefined
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return undefined
  return (now.getTime() - then) / 3_600_000
}

function computeMinutesSince(iso: string | undefined, now: Date): number | undefined {
  if (!iso) return undefined
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return undefined
  return (now.getTime() - then) / 60_000
}
