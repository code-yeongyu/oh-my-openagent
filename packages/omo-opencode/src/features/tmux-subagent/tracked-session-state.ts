import type { TrackedSession } from "./types"

export function createTrackedSession(params: {
  sessionId: string
  paneId: string
  description: string
  attachReady?: boolean
  now?: Date
}): TrackedSession {
  const now = params.now ?? new Date()

  return {
    sessionId: params.sessionId,
    paneId: params.paneId,
    description: params.description,
    attachReady: params.attachReady ?? false,
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
