export type TeamLayoutMember = {
  readonly name: string
  readonly sessionId: string
  readonly worktreePath?: string
}

export type TmuxSessionManager = {
  readonly getServerUrl: () => string
  readonly getCtxServerUrl?: () => string | undefined
}

export type TeamLayoutResult = {
  readonly focusWindowId: string
  readonly gridWindowId?: string
  readonly focusPanesByMember: Record<string, string>
  readonly gridPanesByMember: Record<string, string>
  readonly targetSessionId: string
  readonly ownedSession: boolean
}

export type TeamLayoutCleanupTarget = {
  readonly ownedSession: boolean
  readonly targetSessionId: string
  readonly focusWindowId?: string
  readonly gridWindowId?: string
  readonly paneIds?: readonly string[]
}

export type CreateTeamLayoutRequest = {
  readonly teamRunId: string
  readonly members: readonly TeamLayoutMember[]
  readonly tmuxMgr: TmuxSessionManager
}

export type RemoveTeamLayoutRequest = {
  readonly teamRunId: string
  readonly cleanupTarget?: TeamLayoutCleanupTarget
}

export type TeamLayoutBackend = {
  readonly kind: string
  readonly canVisualize: () => boolean
  readonly createLayout: (request: CreateTeamLayoutRequest) => Promise<TeamLayoutResult | null>
  readonly removeLayout: (request: RemoveTeamLayoutRequest) => Promise<void>
}

export function isTeamLayoutBackend(value: unknown): value is TeamLayoutBackend {
  return typeof value === "object"
    && value !== null
    && "canVisualize" in value
    && "createLayout" in value
    && "removeLayout" in value
}
