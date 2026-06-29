import { isServerRunning, runTmuxCommand, type TmuxCommandResult } from "@oh-my-opencode/tmux-core"
import { log } from "../logger"
import { shellSingleQuote } from "../shell-quote"
import { resolveCallerTmuxSession } from "./resolve-caller-tmux-session"
import type {
  TeamLayoutBackend,
  TeamLayoutCleanupTarget,
  TeamLayoutMember,
  TeamLayoutResult,
} from "./backend"

const TEAM_PANE_TITLE_PREFIX = "omo-team-"
const OMO_ATTACH_SERVER_URL_OPTION = "@omo_attach_server_url"
const OMO_ATTACH_SESSION_ID_OPTION = "@omo_attach_session_id"

export type TeamLayoutDeps = {
  readonly runTmuxCommand: (tmuxPath: string, args: Array<string>, options?: { retry?: number; timeoutMs?: number }) => Promise<TmuxCommandResult>
  readonly isServerRunning: typeof isServerRunning
  readonly getTmuxPath: () => Promise<string | null | undefined>
  readonly resolveCallerTmuxSession: typeof resolveCallerTmuxSession
  readonly log: typeof log
}

const defaultDeps: TeamLayoutDeps = {
  runTmuxCommand,
  isServerRunning,
  getTmuxPath: async () => "tmux",
  resolveCallerTmuxSession,
  log,
}

export function isTeamLayoutDeps(value: unknown): value is TeamLayoutDeps {
  return typeof value === "object"
    && value !== null
    && "runTmuxCommand" in value
    && "getTmuxPath" in value
}

export function canUseTmuxTeamLayout(): boolean {
  return process.env.TMUX !== undefined
}

function getPaneWorkingDirectory(member: TeamLayoutMember): string {
  return member.worktreePath ?? process.cwd()
}

function buildAttachCommand(member: TeamLayoutMember, serverUrl: string): string {
  return `opencode attach ${shellSingleQuote(serverUrl)} --session ${shellSingleQuote(member.sessionId)} --dir ${shellSingleQuote(getPaneWorkingDirectory(member))}`
}

function buildPaneEnvironmentArgs(): string[] {
  const password = process.env.OPENCODE_SERVER_PASSWORD
  if (!password) {
    return []
  }

  const environmentArgs = ["-e", `OPENCODE_SERVER_PASSWORD=${password}`]
  const username = process.env.OPENCODE_SERVER_USERNAME
  if (username !== undefined) {
    environmentArgs.push("-e", `OPENCODE_SERVER_USERNAME=${username}`)
  }

  return environmentArgs
}

async function listPanesInWindow(tmuxPath: string, windowTarget: string, deps: TeamLayoutDeps): Promise<Array<string>> {
  const result = await deps.runTmuxCommand(tmuxPath, ["list-panes", "-t", windowTarget, "-F", "#{pane_id}"])
  if (!result.success || !result.output) return []
  return result.output.trim().split("\n").filter(Boolean)
}

function selectExistingTeammatePane(teammatePanes: Array<string>, callerPaneId: string): string {
  return teammatePanes[Math.floor(teammatePanes.length / 2)] ?? teammatePanes[teammatePanes.length - 1] ?? callerPaneId
}

function buildSplitArgs(callerPaneId: string, teammatePanes: Array<string>, member: TeamLayoutMember): Array<string> {
  const environmentArgs = buildPaneEnvironmentArgs()
  if (teammatePanes.length === 0) {
    return ["split-window", ...environmentArgs, "-t", callerPaneId, "-h", "-d", "-l", "70%", "-P", "-F", "#{pane_id}", "-c", getPaneWorkingDirectory(member)]
  }

  return [
    "split-window",
    ...environmentArgs,
    "-t",
    selectExistingTeammatePane(teammatePanes, callerPaneId),
    teammatePanes.length % 2 === 1 ? "-v" : "-h",
    "-d",
    "-P",
    "-F",
    "#{pane_id}",
    "-c",
    getPaneWorkingDirectory(member),
  ]
}

async function createTeamLayoutInCallerWindow(
  tmuxPath: string,
  callerPaneId: string,
  windowTarget: string,
  members: readonly TeamLayoutMember[],
  serverUrl: string,
  deps: TeamLayoutDeps,
): Promise<{ readonly focusWindowId: string; readonly focusPanesByMember: Record<string, string> } | null> {
  const panesByMember: Record<string, string> = {}
  const existingPanes = await listPanesInWindow(tmuxPath, windowTarget, deps)
  let teammatePanes = existingPanes.filter((paneId) => paneId !== callerPaneId)

  for (const member of members) {
    const split = await deps.runTmuxCommand(tmuxPath, buildSplitArgs(callerPaneId, teammatePanes, member))
    if (!split.success || !split.output) return null

    const paneId = split.output.trim()
    teammatePanes = [...teammatePanes, paneId]
    panesByMember[member.name] = paneId
    await deps.runTmuxCommand(tmuxPath, ["select-pane", "-t", paneId, "-T", `${TEAM_PANE_TITLE_PREFIX}${member.name}`])
    await deps.runTmuxCommand(tmuxPath, ["set-option", "-p", "-t", paneId, OMO_ATTACH_SERVER_URL_OPTION, serverUrl])
    await deps.runTmuxCommand(tmuxPath, ["set-option", "-p", "-t", paneId, OMO_ATTACH_SESSION_ID_OPTION, member.sessionId])
    await deps.runTmuxCommand(tmuxPath, ["send-keys", "-t", paneId, buildAttachCommand(member, serverUrl), "Enter"])
  }

  const layoutResult = await deps.runTmuxCommand(tmuxPath, ["select-layout", "-t", windowTarget, "main-vertical"])
  if (!layoutResult.success) return null

  const resizeResult = await deps.runTmuxCommand(tmuxPath, ["resize-pane", "-t", callerPaneId, "-x", "30%"])
  if (!resizeResult.success) return null

  return { focusWindowId: windowTarget, focusPanesByMember: panesByMember }
}

async function createTmuxLayout(
  teamRunId: string,
  members: readonly TeamLayoutMember[],
  tmuxMgr: { readonly getServerUrl: () => string; readonly getCtxServerUrl?: () => string | undefined },
  deps: TeamLayoutDeps,
): Promise<TeamLayoutResult | null> {
  if (!canUseTmuxTeamLayout()) {
    deps.log("tmux visualization unavailable, skipping")
    return null
  }
  if (members.length === 0) {
    return null
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
      return null
    }

    const tmuxPath = await deps.getTmuxPath()
    if (!tmuxPath) {
      deps.log("tmux visualization unavailable, skipping")
      return null
    }

    const callerSession = await deps.resolveCallerTmuxSession(tmuxPath)
    if (!callerSession) {
      deps.log("tmux visualization requires a resolvable caller tmux pane, skipping", { teamRunId })
      return null
    }

    const focus = await createTeamLayoutInCallerWindow(tmuxPath, callerSession.paneId, callerSession.windowTarget, members, serverUrl, deps)
    if (!focus) return null

    return {
      focusWindowId: focus.focusWindowId,
      gridWindowId: undefined,
      focusPanesByMember: focus.focusPanesByMember,
      gridPanesByMember: {},
      targetSessionId: callerSession.sessionId,
      ownedSession: false,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? String(error) : String(error)
    deps.log("tmux visualization unavailable, skipping", { error: errorMessage })
    return null
  }
}

async function removeTmuxLayout(teamRunId: string, cleanupTarget: TeamLayoutCleanupTarget | undefined, deps: TeamLayoutDeps): Promise<void> {
  if (!canUseTmuxTeamLayout()) return

  try {
    const tmuxPath = await deps.getTmuxPath()
    if (!tmuxPath) return

    if (cleanupTarget?.ownedSession !== false) {
      await deps.runTmuxCommand(tmuxPath, ["kill-session", "-t", cleanupTarget?.targetSessionId ?? `omo-team-${teamRunId}`])
      return
    }

    if (cleanupTarget?.paneIds && cleanupTarget.paneIds.length > 0) {
      for (const paneId of cleanupTarget.paneIds) {
        try {
          await deps.runTmuxCommand(tmuxPath, ["kill-pane", "-t", paneId])
        } catch (error) {
          if (!(error instanceof Error)) {
            deps.log("tmux team pane cleanup failed", { teamRunId, paneId })
            continue
          }
          deps.log("tmux team pane cleanup failed", { teamRunId, paneId })
        }
      }
      return
    }

    for (const windowId of [cleanupTarget.focusWindowId, cleanupTarget.gridWindowId]) {
      if (!windowId) continue
      try {
        await deps.runTmuxCommand(tmuxPath, ["kill-window", "-t", windowId])
      } catch (windowError) {
        const errorMessage = windowError instanceof Error ? String(windowError) : String(windowError)
        deps.log("tmux team layout window cleanup failed", { teamRunId, windowId, error: errorMessage })
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? String(error) : String(error)
    deps.log("tmux team layout cleanup failed", { teamRunId, error: errorMessage })
  }
}

export function createTmuxTeamLayoutBackend(deps: TeamLayoutDeps = defaultDeps): TeamLayoutBackend {
  return {
    kind: "tmux",
    canVisualize: canUseTmuxTeamLayout,
    createLayout: (request) => createTmuxLayout(request.teamRunId, request.members, request.tmuxMgr, deps),
    removeLayout: (request) => removeTmuxLayout(request.teamRunId, request.cleanupTarget, deps),
  }
}
