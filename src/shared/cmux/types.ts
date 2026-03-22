import type { CmuxSplitDirection } from "./cmux-utils/environment"

export interface SpawnPaneResult {
  success: boolean
  paneId?: string
  error?: string
}

export interface PaneDimensions {
  width: number
  height: number
}

export interface CmuxPaneInfo {
  id: string
  workspaceId?: string
  title?: string
  command?: string
  dimensions?: PaneDimensions
}

export interface WindowState {
  panes: CmuxPaneInfo[]
  workspaceId?: string
  windowId?: string
}

export interface TrackedSession {
  sessionId: string
  paneId: string
  status: "active" | "closing" | "closed"
  createdAt: number
  updatedAt: number
}

export interface CapacityConfig {
  enabled: boolean
  layout?: string
  main_pane_size?: number
  main_pane_min_width?: number
  agent_pane_min_width?: number
}

export interface SplitTarget {
  targetPaneId: string
  splitDirection: CmuxSplitDirection
}

export const MIN_PANE_WIDTH = 20
export const MAX_COLS = 3
export const MAX_ROWS = 3
export const DIVIDER_SIZE = 1
export const MIN_SPLIT_HEIGHT = 5
