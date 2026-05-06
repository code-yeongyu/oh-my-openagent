import { log } from "../../../shared"
import { shellSingleQuote } from "../../../shared/shell-env"
import { isServerRunning, runTmuxCommand } from "../../../shared/tmux"
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { resolveCallerTmuxSession } from "./resolve-caller-tmux-session"

type TeamLayoutMember = { name: string; sessionId: string; worktreePath?: string }

export type TeamLayoutResult = {
  focusWindowId: string
  gridWindowId: string
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

function getPaneWorkingDirectory(member: TeamLayoutMember): string {
  return member.worktreePath ?? process.cwd()
}

function buildAttachCommand(member: TeamLayoutMember, serverUrl: string): string {
  return `opencode attach ${shellSingleQuote(serverUrl)} --session ${shellSingleQuote(member.sessionId)} --dir ${shellSingleQuote(getPaneWorkingDirectory(member))}`
}

async function listPanesInWindow(tmuxPath: string, windowId: string): Promise<Array<string>> {
  const result = await runTmuxCommand(tmuxPath, ["list-panes", "-t", windowId, "-F", "#{pane_id}"])
  if (!result.success || !result.output) return []
  return result.output.trim().split("\n").filter(Boolean)
}

async function createTeamWindow(
  tmuxPath: string,
  targetSessionId: string,
  windowName: string,
  layout: "main-vertical" | "tiled",
  members: Array<TeamLayoutMember>,
  serverUrl: string,
): Promise<{ windowId: string; panesByMember: Record<string, string> } | null> {
  const [firstMember, ...restMembers] = members
  if (!firstMember) return null

  const created = await runTmuxCommand(tmuxPath, [
    "new-window", "-d", "-P", "-F", "#{window_id}", "-t", targetSessionId, "-n", windowName,
    "-c", getPaneWorkingDirectory(firstMember),
  ])
  if (!created.success || !created.output) return null

  const windowId = created.output.trim()
  const initialPanes = await listPanesInWindow(tmuxPath, windowId)
  const firstPaneId = initialPanes[0]
  if (!firstPaneId) return null

  const panesByMember: Record<string, string> = { [firstMember.name]: firstPaneId }
  for (const member of restMembers) {
    const split = await runTmuxCommand(tmuxPath, [
      "split-window", "-d", "-P", "-F", "#{pane_id}", "-t", firstPaneId,
      "-c", getPaneWorkingDirectory(member),
    ])
    if (!split.success || !split.output) return null
    panesByMember[member.name] = split.output.trim()
  }

  const layoutResult = await runTmuxCommand(tmuxPath, ["select-layout", "-t", windowId, layout])
  if (!layoutResult.success) return null

  if (layout === "main-vertical") {
    await runTmuxCommand(tmuxPath, ["set-window-option", "-t", windowId, "main-pane-width", "60%"])
    await runTmuxCommand(tmuxPath, ["select-layout", "-t", windowId, layout])
  }

  for (const member of members) {
    const paneId = panesByMember[member.name]
    if (!paneId) return null
    await runTmuxCommand(tmuxPath, ["select-pane", "-t", paneId, "-T", member.name])
    await runTmuxCommand(tmuxPath, ["send-keys", "-t", paneId, buildAttachCommand(member, serverUrl), "Enter"])
  }

  return { windowId, panesByMember }
}

export async function createTeamLayout(teamRunId: string, members: Array<TeamLayoutMember>, tmuxMgr: TmuxSessionManager): Promise<TeamLayoutResult | null> {
  if (!canVisualize()) {
    log("tmux visualization unavailable, skipping")
    return null
  }
  if (members.length === 0) return null

  try {
    const serverUrl = tmuxMgr.getServerUrl()
    if (!(await isServerRunning(serverUrl))) {
      log("opencode server not reachable, skipping team layout", { serverUrl })
      return null
    }

    const tmuxPath = await getTmuxPath()
    if (!tmuxPath) {
      log("tmux visualization unavailable, skipping")
      return null
    }

    const callerSession = await resolveCallerTmuxSession(tmuxPath)
    const fallbackSessionName = `omo-team-${teamRunId}`
    const ownedSession = callerSession === null
    const targetSessionId = callerSession?.sessionId ?? fallbackSessionName

    if (ownedSession) {
      log("falling back to detached team session because caller tmux session could not be resolved", { teamRunId })
      const created = await runTmuxCommand(tmuxPath, ["new-session", "-d", "-s", fallbackSessionName, "-P", "-F", "#{window_id}"])
      if (!created.success || !created.output) return null
    }

    const focus = await createTeamWindow(tmuxPath, targetSessionId, `team-${teamRunId}-focus`, "main-vertical", members, serverUrl)
    const grid = await createTeamWindow(tmuxPath, targetSessionId, `team-${teamRunId}-grid`, "tiled", members, serverUrl)
    if (!focus || !grid) return null

    return {
      focusWindowId: focus.windowId,
      gridWindowId: grid.windowId,
      focusPanesByMember: focus.panesByMember,
      gridPanesByMember: grid.panesByMember,
      targetSessionId,
      ownedSession,
    }
  } catch (error) {
    log("tmux visualization unavailable, skipping", { error: String(error) })
    return null
  }
}

export async function removeTeamLayout(teamRunId: string, _tmuxMgr: TmuxSessionManager): Promise<void>
export async function removeTeamLayout(
  teamRunId: string,
  _cleanupTarget: TeamLayoutCleanupTarget | undefined,
  _tmuxMgr: TmuxSessionManager,
): Promise<void>
export async function removeTeamLayout(
  teamRunId: string,
  tmuxMgrOrCleanupTarget: TmuxSessionManager | TeamLayoutCleanupTarget | undefined,
  _tmuxMgr?: TmuxSessionManager,
): Promise<void> {
  if (!canVisualize()) return
  try {
    const tmuxPath = await getTmuxPath()
    if (!tmuxPath) return

    const cleanupTarget = isTeamLayoutCleanupTarget(tmuxMgrOrCleanupTarget)
      ? tmuxMgrOrCleanupTarget
      : undefined

    if (cleanupTarget?.ownedSession !== false) {
      await runTmuxCommand(tmuxPath, ["kill-session", "-t", cleanupTarget?.targetSessionId ?? `omo-team-${teamRunId}`])
      return
    }

    if (cleanupTarget?.paneIds && cleanupTarget.paneIds.length > 0) {
      for (const paneId of cleanupTarget.paneIds) {
        try {
          await runTmuxCommand(tmuxPath, ["kill-pane", "-t", paneId])
        } catch {
          log("tmux team pane cleanup failed", { teamRunId, paneId })
        }
      }
      return
    }

    for (const windowId of [cleanupTarget.focusWindowId, cleanupTarget.gridWindowId]) {
      if (!windowId) continue
      try {
        await runTmuxCommand(tmuxPath, ["kill-window", "-t", windowId])
      } catch (windowError) {
        log("tmux team layout window cleanup failed", { teamRunId, windowId, error: String(windowError) })
      }
    }
  } catch (error) {
    log("tmux team layout cleanup failed", { teamRunId, error: String(error) })
  }
}

function isTeamLayoutCleanupTarget(value: TmuxSessionManager | TeamLayoutCleanupTarget | undefined): value is TeamLayoutCleanupTarget {
  return value !== undefined && "ownedSession" in value && "targetSessionId" in value
}
