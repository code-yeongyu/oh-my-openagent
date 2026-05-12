import { log } from "../../../shared"
import { shellSingleQuote } from "../../../shared/shell-env"
import * as sharedTmuxModule from "../../../shared/tmux"
import * as tmuxPathResolverModule from "../../../tools/interactive-bash/tmux-path-resolver"
import type { ServerUrlSource, TmuxSessionManager } from "../../tmux-subagent/manager"
import type { TeamLayoutSkipReason } from "../types"
import { resolveCallerTmuxSession } from "./resolve-caller-tmux-session"

export type { TeamLayoutSkipReason } from "../types"

type TeamLayoutMember = { name: string; sessionId: string; worktreePath?: string }
type TmuxCommandResult = Awaited<ReturnType<typeof sharedTmuxModule.runTmuxCommand>>

export type TeamLayoutDeps = {
  runTmuxCommand: (tmuxPath: string, args: Array<string>, options?: Parameters<typeof sharedTmuxModule.runTmuxCommand>[2]) => Promise<TmuxCommandResult>
  isServerRunning: typeof sharedTmuxModule.isServerRunning
  getTmuxPath: typeof tmuxPathResolverModule.getTmuxPath
  resolveCallerTmuxSession: typeof resolveCallerTmuxSession
}

const defaultDeps: TeamLayoutDeps = {
  runTmuxCommand: sharedTmuxModule.runTmuxCommand,
  isServerRunning: sharedTmuxModule.isServerRunning,
  getTmuxPath: tmuxPathResolverModule.getTmuxPath,
  resolveCallerTmuxSession,
}

export type TeamLayoutResult = {
  focusWindowId: string
  gridWindowId?: string
  focusPanesByMember: Record<string, string>
  gridPanesByMember: Record<string, string>
  targetSessionId: string
  ownedSession: boolean
}

export type TeamLayoutSkipOutcome = {
  skipped: true
  reason: TeamLayoutSkipReason
  detail?: string
  serverUrl?: string
  serverUrlSource?: ServerUrlSource
}

export type TeamLayoutOutcome =
  | ({ skipped: false } & TeamLayoutResult)
  | TeamLayoutSkipOutcome

export type TeamLayoutCleanupTarget = {
  ownedSession: boolean
  targetSessionId: string
  focusWindowId?: string
  gridWindowId?: string
  paneIds?: Array<string>
}

export function canVisualize(): boolean { return process.env.TMUX !== undefined }

function getPaneWorkingDirectory(member: TeamLayoutMember): string {
  return member.worktreePath ?? process.cwd()
}

function buildAttachCommand(member: TeamLayoutMember, serverUrl: string): string {
  return `opencode attach ${shellSingleQuote(serverUrl)} --session ${shellSingleQuote(member.sessionId)} --dir ${shellSingleQuote(getPaneWorkingDirectory(member))}`
}

function createSkipOutcome(args: {
  reason: TeamLayoutSkipReason
  detail?: string
  serverUrl?: string
  serverUrlSource?: ServerUrlSource
}): TeamLayoutSkipOutcome {
  const outcome: TeamLayoutSkipOutcome = { skipped: true, reason: args.reason }
  if (args.detail !== undefined) outcome.detail = args.detail
  if (args.serverUrl !== undefined) outcome.serverUrl = args.serverUrl
  if (args.serverUrlSource !== undefined) outcome.serverUrlSource = args.serverUrlSource
  return outcome
}

function resolveServerUrlSource(tmuxMgr: TmuxSessionManager): ServerUrlSource | undefined {
  const sourceProvider = tmuxMgr as { getServerUrlSource?: () => ServerUrlSource }
  return sourceProvider.getServerUrlSource?.()
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
  if (teammatePanes.length === 0) {
    return ["split-window", "-t", callerPaneId, "-h", "-l", "70%", "-P", "-F", "#{pane_id}", "-c", getPaneWorkingDirectory(member)]
  }

  return [
    "split-window",
    "-t",
    selectExistingTeammatePane(teammatePanes, callerPaneId),
    teammatePanes.length % 2 === 1 ? "-v" : "-h",
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
  members: Array<TeamLayoutMember>,
  serverUrl: string,
  deps: TeamLayoutDeps,
): Promise<{ focusWindowId: string; focusPanesByMember: Record<string, string> } | null> {
  const panesByMember: Record<string, string> = {}
  const existingPanes = await listPanesInWindow(tmuxPath, windowTarget, deps)
  let teammatePanes = existingPanes.filter((paneId) => paneId !== callerPaneId)

  for (const member of members) {
    const split = await deps.runTmuxCommand(tmuxPath, buildSplitArgs(callerPaneId, teammatePanes, member))
    if (!split.success || !split.output) return null

    const paneId = split.output.trim()
    teammatePanes = [...teammatePanes, paneId]
    panesByMember[member.name] = paneId
    await deps.runTmuxCommand(tmuxPath, ["select-pane", "-t", paneId, "-T", member.name])
    await deps.runTmuxCommand(tmuxPath, ["send-keys", "-t", paneId, buildAttachCommand(member, serverUrl), "Enter"])
  }

  const layoutResult = await deps.runTmuxCommand(tmuxPath, ["select-layout", "-t", windowTarget, "main-vertical"])
  if (!layoutResult.success) return null

  const resizeResult = await deps.runTmuxCommand(tmuxPath, ["resize-pane", "-t", callerPaneId, "-x", "30%"])
  if (!resizeResult.success) return null

  return { focusWindowId: windowTarget, focusPanesByMember: panesByMember }
}

export async function createTeamLayout(teamRunId: string, members: Array<TeamLayoutMember>, tmuxMgr: TmuxSessionManager, deps: TeamLayoutDeps = defaultDeps): Promise<TeamLayoutOutcome> {
  if (!canVisualize()) {
    log("tmux visualization unavailable, skipping")
    return createSkipOutcome({ reason: "tmux-unavailable" })
  }
  if (members.length === 0) {
    return createSkipOutcome({ reason: "layout-creation-failed", detail: "No team members to visualize." })
  }

  let serverUrl: string | undefined
  let serverUrlSource: ServerUrlSource | undefined
  try {
    serverUrl = tmuxMgr.getServerUrl()
    serverUrlSource = resolveServerUrlSource(tmuxMgr)
    if (!(await deps.isServerRunning(serverUrl))) {
      log("opencode server not reachable, skipping team layout", { serverUrl })
      return createSkipOutcome({ reason: "server-unreachable", serverUrl, serverUrlSource })
    }

    const tmuxPath = await deps.getTmuxPath()
    if (!tmuxPath) {
      log("tmux visualization unavailable, skipping")
      return createSkipOutcome({ reason: "tmux-binary-missing", serverUrl, serverUrlSource })
    }

    const callerSession = await deps.resolveCallerTmuxSession(tmuxPath)
    if (!callerSession) {
      log("tmux visualization requires a resolvable caller tmux pane, skipping", { teamRunId })
      return createSkipOutcome({ reason: "caller-pane-unresolved", serverUrl, serverUrlSource })
    }

    const focus = await createTeamLayoutInCallerWindow(tmuxPath, callerSession.paneId, callerSession.windowTarget, members, serverUrl, deps)
    if (!focus) {
      log("tmux team layout creation failed, skipping", { teamRunId })
      return createSkipOutcome({ reason: "layout-creation-failed", serverUrl, serverUrlSource })
    }

    return {
      skipped: false,
      focusWindowId: focus.focusWindowId,
      gridWindowId: undefined,
      focusPanesByMember: focus.focusPanesByMember,
      gridPanesByMember: {},
      targetSessionId: callerSession.sessionId,
      ownedSession: false,
    }
  } catch (error) {
    log("tmux visualization unavailable, skipping", { error: String(error) })
    return createSkipOutcome({ reason: "layout-creation-failed", detail: String(error), serverUrl, serverUrlSource })
  }
}

export async function removeTeamLayout(
  teamRunId: string,
  tmuxMgrOrCleanupTarget: TmuxSessionManager | TeamLayoutCleanupTarget | undefined,
  tmuxMgrOrDeps?: TmuxSessionManager | TeamLayoutDeps,
  deps: TeamLayoutDeps = defaultDeps,
): Promise<void> {
  if (!canVisualize()) return
  try {
    const resolvedDeps = isTeamLayoutDeps(tmuxMgrOrDeps) ? tmuxMgrOrDeps : deps
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
        } catch {
          log("tmux team pane cleanup failed", { teamRunId, paneId })
        }
      }
      return
    }

    for (const windowId of [cleanupTarget.focusWindowId, cleanupTarget.gridWindowId]) {
      if (!windowId) continue
      try {
        await resolvedDeps.runTmuxCommand(tmuxPath, ["kill-window", "-t", windowId])
      } catch (windowError) {
        log("tmux team layout window cleanup failed", { teamRunId, windowId, error: String(windowError) })
      }
    }
  } catch (error) {
    log("tmux team layout cleanup failed", { teamRunId, error: String(error) })
  }
}

function isTeamLayoutDeps(value: TmuxSessionManager | TeamLayoutDeps | undefined): value is TeamLayoutDeps {
  return value !== undefined && "runTmuxCommand" in value && "getTmuxPath" in value
}

function isTeamLayoutCleanupTarget(value: TmuxSessionManager | TeamLayoutCleanupTarget | undefined): value is TeamLayoutCleanupTarget {
  return value !== undefined && "ownedSession" in value && "targetSessionId" in value
}
