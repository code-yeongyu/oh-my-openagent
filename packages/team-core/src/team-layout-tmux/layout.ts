import { isServerRunning, runTmuxCommand, type TmuxCommandResult } from "@oh-my-opencode/tmux-core"
import { log } from "../logger"
import { createCallerWindowTeamLayout, type TeamLayoutMember } from "./caller-window-layout"
import { resolveCallerTmuxSession } from "./resolve-caller-tmux-session"

type TmuxSessionManager = {
  getServerUrl: () => string
  getCtxServerUrl?: () => string | undefined
}
const INTERNAL_TMUX_FAILURE_REASON = "tmux visualization unavailable: internal tmux operation failed"

export type TeamLayoutDeps = {
  runTmuxCommand: (tmuxPath: string, args: Array<string>, options?: { retry?: number; timeoutMs?: number }) => Promise<TmuxCommandResult>
  isServerRunning: typeof isServerRunning
  getTmuxPath: () => Promise<string | null | undefined>
  resolveCallerTmuxSession: typeof resolveCallerTmuxSession
  log: typeof log
}

const defaultDeps: TeamLayoutDeps = {
  runTmuxCommand,
  isServerRunning,
  getTmuxPath: async () => "tmux",
  resolveCallerTmuxSession,
  log,
}

export type TeamLayoutResult = {
  focusWindowId: string
  gridWindowId?: string
  focusPanesByMember: Record<string, string>
  gridPanesByMember: Record<string, string>
  targetSessionId: string
  ownedSession: boolean
}

export type TeamLayoutCleanupTarget = {
  ownedSession: boolean
  targetSessionId: string
  focusWindowId?: string
  gridWindowId?: string
  paneIds?: Array<string>
}

export function canVisualize(): boolean { return process.env.TMUX !== undefined }

export type TeamLayoutAttempt = {
  layout: TeamLayoutResult | null
  skipReason?: string
}

export async function createTeamLayoutWithReason(teamRunId: string, members: Array<TeamLayoutMember>, tmuxMgr: TmuxSessionManager, deps: TeamLayoutDeps = defaultDeps): Promise<TeamLayoutAttempt> {
  if (!canVisualize()) {
    const skipReason = "tmux visualization unavailable: not inside a tmux session"
    deps.log(skipReason)
    return { layout: null, skipReason }
  }
  if (members.length === 0) {
    return { layout: null }
  }

  try {
    const serverUrl = tmuxMgr.getServerUrl()
    if (!(await deps.isServerRunning(serverUrl))) {
      const ctxServerUrl = tmuxMgr.getCtxServerUrl?.()
      deps.log("opencode server not reachable, skipping team layout (see issue #3963)", {
        kind: "warning",
        teamRunId,
        serverUrl,
        ctxServerUrl: ctxServerUrl && ctxServerUrl !== serverUrl ? ctxServerUrl : undefined,
        hint:
          ctxServerUrl && ctxServerUrl !== serverUrl
            ? "ctx.serverUrl was discarded (likely port 0); launch opencode with --port N and OPENCODE_PORT=N to bind a real port"
            : "no opencode server is listening on the fallback URL",
      })
      const skipReason = ctxServerUrl && ctxServerUrl !== serverUrl
        ? `tmux visualization skipped: opencode server not reachable at ${serverUrl} (ctx.serverUrl was discarded, likely port 0); launch opencode with --port N and OPENCODE_PORT=N to bind a real port`
        : `tmux visualization skipped: no opencode server is listening at ${serverUrl}; launch opencode with --port N and OPENCODE_PORT=N to bind a real port`
      return { layout: null, skipReason }
    }

    const tmuxPath = await deps.getTmuxPath()
    if (!tmuxPath) {
      const skipReason = "tmux visualization unavailable: tmux binary not found"
      deps.log(skipReason)
      return { layout: null, skipReason }
    }

    const callerSession = await deps.resolveCallerTmuxSession(tmuxPath)
    if (!callerSession) {
      const skipReason = "tmux visualization skipped: could not resolve the caller tmux pane"
      deps.log(skipReason, { teamRunId })
      return { layout: null, skipReason }
    }

    const focus = await createCallerWindowTeamLayout(
      teamRunId,
      tmuxPath,
      callerSession.paneId,
      callerSession.windowTarget,
      members,
      serverUrl,
      deps,
    )
    if (!focus) {
      return { layout: null, skipReason: "tmux visualization skipped: failed to split tmux panes for team members" }
    }

    return {
      layout: {
        focusWindowId: focus.focusWindowId,
        gridWindowId: undefined,
        focusPanesByMember: focus.focusPanesByMember,
        gridPanesByMember: {},
        targetSessionId: callerSession.sessionId,
        ownedSession: false,
      },
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.toString() : String(error)
    deps.log("tmux visualization unavailable, skipping", { error: errorMessage })
    return { layout: null, skipReason: INTERNAL_TMUX_FAILURE_REASON }
  }
}

export async function createTeamLayout(teamRunId: string, members: Array<TeamLayoutMember>, tmuxMgr: TmuxSessionManager, deps: TeamLayoutDeps = defaultDeps): Promise<TeamLayoutResult | null> {
  return (await createTeamLayoutWithReason(teamRunId, members, tmuxMgr, deps)).layout
}

export async function removeTeamLayout(
  teamRunId: string,
  tmuxMgrOrCleanupTarget: TmuxSessionManager | TeamLayoutCleanupTarget | undefined,
  tmuxMgrOrDeps?: TmuxSessionManager | TeamLayoutDeps,
  deps: TeamLayoutDeps = defaultDeps,
): Promise<void> {
  if (!canVisualize()) return
  const resolvedDeps = isTeamLayoutDeps(tmuxMgrOrDeps) ? tmuxMgrOrDeps : deps
  try {
    const tmuxPath = await resolvedDeps.getTmuxPath()
    if (!tmuxPath) return

    const cleanupTarget = isTeamLayoutCleanupTarget(tmuxMgrOrCleanupTarget)
      ? tmuxMgrOrCleanupTarget
      : undefined

    if (cleanupTarget?.ownedSession !== false) {
      await resolvedDeps.runTmuxCommand(tmuxPath, ["kill-session", "-t", cleanupTarget?.targetSessionId ?? `omo-team-${teamRunId}`])
      return
    }

    if (cleanupTarget?.paneIds && cleanupTarget.paneIds.length > 0) {
      for (const paneId of cleanupTarget.paneIds) {
        try {
          await resolvedDeps.runTmuxCommand(tmuxPath, ["kill-pane", "-t", paneId])
        } catch (error) {
          if (!(error instanceof Error)) {
            resolvedDeps.log("tmux team pane cleanup failed", { teamRunId, paneId })
            continue
          }
          resolvedDeps.log("tmux team pane cleanup failed", { teamRunId, paneId })
        }
      }
      return
    }

    for (const windowId of [cleanupTarget.focusWindowId, cleanupTarget.gridWindowId]) {
      if (!windowId) continue
      try {
        await resolvedDeps.runTmuxCommand(tmuxPath, ["kill-window", "-t", windowId])
      } catch (windowError) {
        const errorMessage = windowError instanceof Error ? String(windowError) : String(windowError)
        resolvedDeps.log("tmux team layout window cleanup failed", { teamRunId, windowId, error: errorMessage })
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? String(error) : String(error)
    resolvedDeps.log("tmux team layout cleanup failed", { teamRunId, error: errorMessage })
  }
}

function isTeamLayoutDeps(value: TmuxSessionManager | TeamLayoutDeps | undefined): value is TeamLayoutDeps {
  return value !== undefined && "runTmuxCommand" in value && "getTmuxPath" in value
}

function isTeamLayoutCleanupTarget(value: TmuxSessionManager | TeamLayoutCleanupTarget | undefined): value is TeamLayoutCleanupTarget {
  return value !== undefined && "ownedSession" in value && "targetSessionId" in value
}
