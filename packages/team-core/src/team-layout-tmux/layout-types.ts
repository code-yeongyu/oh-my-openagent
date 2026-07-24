import type {
  isCmuxCompatEnvironment,
  isServerRunning,
  RunTmuxOptions,
  TmuxCommandResult,
  TmuxServerAccess,
} from "@oh-my-opencode/tmux-core"

import type { log } from "../logger"
import type { resolveCallerTmuxSession } from "./resolve-caller-tmux-session"
import type { TeamLayoutExecutionTarget } from "./execution-target"

export type { TeamLayoutExecutionTarget } from "./execution-target"

export type TeamLayoutMember = {
  readonly name: string
  readonly sessionId: string
  readonly worktreePath?: string
}

export type TmuxSessionManager = {
  readonly getServerUrl: () => string
  readonly getCtxServerUrl?: () => string | undefined
  readonly getTmuxServerAccess?: () => TmuxServerAccess | undefined
}

export type TeamLayoutDeps = {
  readonly runTmuxCommand: (
    tmuxPath: string,
    args: Array<string>,
    options?: RunTmuxOptions,
  ) => Promise<TmuxCommandResult>
  readonly isServerRunning: typeof isServerRunning
  readonly getTmuxPath: () => Promise<string | null | undefined>
  readonly getTmuxPathForBackend?: (
    backend: TeamLayoutExecutionTarget["backend"],
  ) => Promise<string | null | undefined>
  readonly resolveCallerTmuxSession: typeof resolveCallerTmuxSession
  readonly log: typeof log
  readonly isCmuxCompatEnvironment?: typeof isCmuxCompatEnvironment
  readonly getEnvironment?: () => Readonly<Record<string, string | undefined>>
}

export type TeamLayoutResult = {
  readonly executionTarget: TeamLayoutExecutionTarget
  readonly focusWindowId: string
  readonly gridWindowId?: string
  readonly focusPanesByMember: Record<string, string>
  readonly gridPanesByMember: Record<string, string>
  readonly targetSessionId: string
  readonly ownedSession: boolean
}

export type TeamLayoutCleanupTarget = {
  readonly executionTarget?: TeamLayoutExecutionTarget
  readonly ownedSession: boolean
  readonly targetSessionId: string
  readonly focusWindowId?: string
  readonly gridWindowId?: string
  readonly paneIds?: Array<string>
}

export type TeamLayoutCleanupResult = {
  readonly attemptedPaneIds: readonly string[]
  readonly removedPaneIds: readonly string[]
  readonly skippedPaneIds: readonly string[]
  readonly reason:
    | "backend-unavailable"
    | "failed"
    | "invalid-execution-target"
    | "missing-execution-target"
    | "missing-pane-identifiers"
    | "no-owned-panes"
    | "partial"
    | "removed"
}
