export const TMUX_LAYOUT_VALUES = [
  "main-horizontal",
  "main-vertical",
  "tiled",
  "even-horizontal",
  "even-vertical",
] as const

export const TMUX_ISOLATION_VALUES = ["inline", "window", "session"] as const

export type TmuxLayout = (typeof TMUX_LAYOUT_VALUES)[number]
export type TmuxIsolation = (typeof TMUX_ISOLATION_VALUES)[number]

export type TmuxConfig = {
  readonly enabled: boolean
  readonly layout: TmuxLayout
  readonly main_pane_size: number
  readonly main_pane_min_width: number
  readonly agent_pane_min_width: number
  readonly isolation: TmuxIsolation
}

export type TmuxPaneEnvironment = Readonly<Record<string, string>>

export type TmuxServerAccess = {
  readonly serverUrl: string
  readonly checkServerHealth: () => Promise<boolean>
  readonly getPaneEnvironment: () => TmuxPaneEnvironment
}

export type TmuxServerTarget = string | TmuxServerAccess

export interface SpawnPaneResult {
  readonly success: boolean
  readonly paneId?: string
}
