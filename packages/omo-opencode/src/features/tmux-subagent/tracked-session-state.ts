import type { TrackedSession } from "./types"

export function createTrackedSession(params: {
  sessionId: string
  paneId: string
  description: string
  now?: Date
  attachActivated?: boolean
}): TrackedSession {
  const now = params.now ?? new Date()

  if (params.attachActivated) {
    return {
      sessionId: params.sessionId,
      paneId: params.paneId,
      description: params.description,
      attachActivated: true,
      attachActivatedAt: now,
      createdAt: now,
      lastSeenAt: now,
      closePending: false,
      closeRetryCount: 0,
      activityVersion: 0,
      stableIdlePolls: 0,
      observedIdleActivityVersion: 0,
    }
  }

  return {
    sessionId: params.sessionId,
    paneId: params.paneId,
    description: params.description,
    attachActivated: false,
    attachActivatedAt: undefined,
    createdAt: now,
    lastSeenAt: now,
    closePending: false,
    closeRetryCount: 0,
    activityVersion: 0,
  }
}

export function markTrackedSessionClosePending(tracked: TrackedSession): TrackedSession {
  return {
    ...tracked,
    closePending: true,
    closeRetryCount: tracked.closePending ? tracked.closeRetryCount + 1 : tracked.closeRetryCount,
  }
}
