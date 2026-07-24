import {
  getHttpServerOriginForLog,
  getReadyTmuxPaneEnvironment,
  isCmuxCompatEnvironment,
  isServerRunning,
  resolveStableTmuxBackend,
  runTmuxCommand,
} from "@oh-my-opencode/tmux-core"

import { log } from "../logger"
import { createTeamLayoutInCallerWindow } from "./caller-window-layout"
import type {
  TeamLayoutCleanupTarget,
  TeamLayoutCleanupResult,
  TeamLayoutDeps,
  TeamLayoutMember,
  TeamLayoutResult,
  TmuxSessionManager,
} from "./layout-types"
import { removeTeamLayoutWithDeps } from "./remove-team-layout"
import { resolveCallerTmuxSession } from "./resolve-caller-tmux-session"
import {
  captureTeamLayoutExecutionTarget,
  resolveTmuxServerAccess,
  runTeamTmuxCommand,
} from "./team-tmux-command"

export type {
  TeamLayoutCleanupTarget,
  TeamLayoutCleanupResult,
  TeamLayoutDeps,
  TeamLayoutExecutionTarget,
  TeamLayoutMember,
  TeamLayoutResult,
  TmuxSessionManager,
} from "./layout-types"

const defaultDeps: TeamLayoutDeps = {
  runTmuxCommand,
  isServerRunning,
  getTmuxPath: async () => "tmux",
  getTmuxPathForBackend: async (backend) => backend,
  resolveCallerTmuxSession,
  log,
  isCmuxCompatEnvironment,
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? "Error" : typeof error
}

export function canVisualize(): boolean {
  return process.env.TMUX !== undefined || isCmuxCompatEnvironment()
}

export async function createTeamLayout(
  teamRunId: string,
  members: TeamLayoutMember[],
  tmuxMgr: TmuxSessionManager,
  deps: TeamLayoutDeps = defaultDeps,
): Promise<TeamLayoutResult | null> {
  if (!canVisualize()) {
    deps.log("tmux visualization unavailable, skipping")
    return null
  }
  if (members.length === 0) return null

  const detectCmux = deps.isCmuxCompatEnvironment ?? isCmuxCompatEnvironment
  const environment = deps.getEnvironment?.() ?? process.env
  try {
    const serverAccess = resolveTmuxServerAccess(tmuxMgr, deps)
    const backend = await resolveStableTmuxBackend(deps.getTmuxPath, detectCmux)
    if (!backend) {
      deps.log("tmux backend changed or executable was unavailable, skipping")
      return null
    }
    const paneEnvironment = await getReadyTmuxPaneEnvironment(serverAccess)
    if (!paneEnvironment) {
      const ctxServerUrl = tmuxMgr.getCtxServerUrl?.()
      const serverOrigin = getHttpServerOriginForLog(serverAccess.serverUrl)
      const ctxServerOrigin = getHttpServerOriginForLog(ctxServerUrl)
      deps.log("server listener not ready, skipping team layout", {
        kind: "warning",
        teamRunId,
        serverOrigin,
        ctxServerOrigin: ctxServerOrigin !== serverOrigin ? ctxServerOrigin : undefined,
      })
      return null
    }
    const executionTarget = captureTeamLayoutExecutionTarget(backend.isCmux, environment)
    if (!executionTarget) {
      deps.log("tmux execution target cannot be persisted safely, skipping team layout", {
        kind: "warning",
        teamRunId,
      })
      return null
    }

    const callerSession = await deps.resolveCallerTmuxSession(
      backend.path,
      environment.TMUX_PANE,
      (path, args) => runTeamTmuxCommand(
        path,
        executionTarget,
        paneEnvironment,
        deps,
        teamRunId,
        () => args,
      ),
    )
    if (!callerSession) {
      deps.log("tmux visualization requires a resolvable caller tmux pane, skipping", { teamRunId })
      return null
    }

    const focus = await createTeamLayoutInCallerWindow({
      callerPaneId: callerSession.paneId,
      deps,
      executionTarget,
      members,
      paneEnvironment,
      serverAccess,
      teamRunId,
      tmuxPath: backend.path,
      windowTarget: callerSession.windowTarget,
    })
    if (!focus) return null

    return {
      executionTarget,
      focusWindowId: focus.focusWindowId,
      gridWindowId: undefined,
      focusPanesByMember: focus.focusPanesByMember,
      gridPanesByMember: {},
      targetSessionId: callerSession.sessionId,
      ownedSession: false,
    }
  } catch (error) {
    deps.log("tmux visualization unavailable, skipping", { errorType: getErrorType(error) })
    return null
  }
}

export function removeTeamLayout(
  teamRunId: string,
  tmuxMgrOrCleanupTarget: TmuxSessionManager | TeamLayoutCleanupTarget | undefined,
  tmuxMgrOrDeps?: TmuxSessionManager | TeamLayoutDeps,
  deps: TeamLayoutDeps = defaultDeps,
): Promise<TeamLayoutCleanupResult> {
  return removeTeamLayoutWithDeps(
    teamRunId,
    tmuxMgrOrCleanupTarget,
    tmuxMgrOrDeps,
    isTeamLayoutDeps(tmuxMgrOrDeps) ? tmuxMgrOrDeps : deps,
  )
}

function isTeamLayoutDeps(
  value: TmuxSessionManager | TeamLayoutDeps | undefined,
): value is TeamLayoutDeps {
  return value !== undefined && "runTmuxCommand" in value && "getTmuxPath" in value
}
