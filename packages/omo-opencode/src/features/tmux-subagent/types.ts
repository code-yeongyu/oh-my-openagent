export interface TrackedSession {
  sessionId: string
  paneId: string
  description: string
  attachActivated: boolean
  attachActivatedAt?: Date
  createdAt: Date
  lastSeenAt: Date
  closePending: boolean
  closeRetryCount: number
  // Set by `finalizeForceRemoveCandidate` when MAX_CLOSE_RETRY_COUNT
  // is reached with the pane still visible. `retryPendingCloses` checks
  // this on subsequent passes: once `Date.now() >= cooldownUntil`, the
  // retry counter and `closePending` reset so polling and retry can
  // attempt the close again. Without this, a wedged pane stays in the
  // tracked sessions map for the rest of the parent session's lifetime.
  closeRetryCooldownUntil?: Date
  // Stability detection fields (prevents premature closure)
  lastMessageCount?: number
  stableIdlePolls?: number
  activityVersion?: number
  observedIdleActivityVersion?: number
}

export const MIN_PANE_WIDTH = 52
export const MIN_PANE_HEIGHT = 11

export interface TmuxPaneInfo {
  paneId: string
  width: number
  height: number
  left: number
  top: number
  title: string
  isActive: boolean
}

export interface WindowState {
  windowWidth: number
  windowHeight: number
  windowActive?: boolean
  sessionAttached?: boolean
  mainPane: TmuxPaneInfo | null
  agentPanes: TmuxPaneInfo[]
}

export type SplitDirection = "-h" | "-v"

export type PaneAction =
  | { type: "close"; paneId: string; sessionId: string }
  | { type: "spawn"; sessionId: string; description: string; targetPaneId: string; splitDirection: SplitDirection }
  | { type: "replace"; paneId: string; oldSessionId: string; newSessionId: string; description: string }

export interface SpawnDecision {
  canSpawn: boolean
  actions: PaneAction[]
  reason?: string
}

export interface CapacityConfig {
  layout?: string
  mainPaneSize?: number
  mainPaneMinWidth: number
  agentPaneWidth: number
}
