export interface TrackedSession {
  sessionId: string
  paneId: string
  description: string
  createdAt: Date
  lastSeenAt: Date
}

/**
 * Raw pane info from tmux list-panes command
 * Source of truth - queried directly from tmux
 */
export interface TmuxPaneInfo {
  paneId: string
  width: number
  left: number
  title: string
  isActive: boolean
}

/**
 * Current window state queried from tmux
 * This is THE source of truth, not our internal Map
 */
export interface WindowState {
  windowWidth: number
  mainPane: TmuxPaneInfo | null
  agentPanes: TmuxPaneInfo[]
}

/**
 * Actions that can be executed on tmux panes
 */
export type PaneAction =
  | { type: "close"; paneId: string; sessionId: string }
  | { type: "spawn"; sessionId: string; description: string; targetPaneId: string }

/**
 * Decision result from the decision engine
 */
export interface SpawnDecision {
  canSpawn: boolean
  actions: PaneAction[]
  reason?: string
}

/**
 * Config needed for capacity calculation
 */
export interface CapacityConfig {
  mainPaneMinWidth: number
  agentPaneWidth: number
}
