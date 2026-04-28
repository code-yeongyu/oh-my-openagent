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

const PANE_SHELL_INIT_DELAY_MS = 200

let paneCreationLock: Promise<void> = Promise.resolve()

function acquirePaneCreationLock(): Promise<() => void> {
  let release: () => void
  const newLock = new Promise<void>((resolve) => { release = resolve })
  const previousLock = paneCreationLock
  paneCreationLock = newLock
  return previousLock.then(() => release!)
}

async function resolveCurrentWindowTarget(tmuxPath: string, leaderPaneId: string): Promise<string | null> {
  const result = await runTmuxCommand(tmuxPath, ["display", "-p", "-t", leaderPaneId, "#{session_name}:#{window_index}"])
  if (!result.success || !result.output) return null
  return result.output.trim()
}

async function resolveCurrentWindowId(tmuxPath: string, leaderPaneId: string): Promise<string | null> {
  const result = await runTmuxCommand(tmuxPath, ["display", "-p", "-t", leaderPaneId, "#{window_id}"])
  if (!result.success || !result.output) return null
  return result.output.trim()
}

async function listPanesInWindow(tmuxPath: string, windowTarget: string): Promise<Array<string>> {
  const result = await runTmuxCommand(tmuxPath, ["list-panes", "-t", windowTarget, "-F", "#{pane_id}"])
  if (!result.success || !result.output) return []
  return result.output.trim().split("\n").filter(Boolean)
}

async function rebalanceWithLeader(tmuxPath: string, windowTarget: string, leaderPaneId: string): Promise<void> {
  const panes = await listPanesInWindow(tmuxPath, windowTarget)
  if (panes.length <= 1) return
  await runTmuxCommand(tmuxPath, ["select-layout", "-t", windowTarget, "main-vertical"])
  await runTmuxCommand(tmuxPath, ["resize-pane", "-t", leaderPaneId, "-x", "30%"])
}

async function createTeammatePaneInCurrentWindow(
  tmuxPath: string,
  leaderPaneId: string,
  windowTarget: string,
  member: TeamLayoutMember,
): Promise<string | null> {
  const releaseLock = await acquirePaneCreationLock()
  try {
    const panes = await listPanesInWindow(tmuxPath, windowTarget)
    const isFirstTeammate = panes.length === 1

    let splitResult
    if (isFirstTeammate) {
      splitResult = await runTmuxCommand(tmuxPath, [
        "split-window", "-t", leaderPaneId, "-h", "-l", "70%", "-d",
        "-P", "-F", "#{pane_id}", "-c", getPaneWorkingDirectory(member),
      ])
    } else {
      const teammatePanes = panes.filter((p) => p !== leaderPaneId)
      const teammateCount = teammatePanes.length
      const splitVertically = teammateCount % 2 === 1
      const targetIndex = Math.floor((teammateCount - 1) / 2)
      const targetPane = teammatePanes[targetIndex] ?? teammatePanes[teammatePanes.length - 1]

      splitResult = await runTmuxCommand(tmuxPath, [
        "split-window", "-t", targetPane!, splitVertically ? "-v" : "-h", "-d",
        "-P", "-F", "#{pane_id}", "-c", getPaneWorkingDirectory(member),
      ])
    }

    if (!splitResult.success || !splitResult.output) return null
    const paneId = splitResult.output.trim()

    await runTmuxCommand(tmuxPath, ["select-pane", "-t", paneId, "-T", member.name])
    await runTmuxCommand(tmuxPath, ["set-option", "-p", "-t", paneId, "pane-border-style", "fg=cyan"])
    await runTmuxCommand(tmuxPath, ["set-option", "-p", "-t", paneId, "pane-active-border-style", "fg=cyan"])
    await runTmuxCommand(tmuxPath, ["set-option", "-p", "-t", paneId, "pane-border-format", "#[fg=cyan,bold] #{pane_title} #[default]"])

    await rebalanceWithLeader(tmuxPath, windowTarget, leaderPaneId)
    await new Promise((resolve) => setTimeout(resolve, PANE_SHELL_INIT_DELAY_MS))

    return paneId
  } finally {
    releaseLock()
  }
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
    const leaderPaneId = process.env.TMUX_PANE
    const fallbackSessionName = `omo-team-${teamRunId}`
    const ownedSession = callerSession === null || !leaderPaneId
    const targetSessionId = callerSession?.sessionId ?? fallbackSessionName

    if (ownedSession) {
      log("falling back to detached team session because caller tmux session could not be resolved", { teamRunId })
      const created = await runTmuxCommand(tmuxPath, ["new-session", "-d", "-s", fallbackSessionName, "-P", "-F", "#{window_id}"])
      if (!created.success || !created.output) return null
    }

    if (!leaderPaneId || ownedSession) {
      log("no leader pane for split layout, skipping visualization", { teamRunId })
      return null
    }

    const windowTarget = await resolveCurrentWindowTarget(tmuxPath, leaderPaneId)
    const windowId = await resolveCurrentWindowId(tmuxPath, leaderPaneId)
    if (!windowTarget || !windowId) return null

    await runTmuxCommand(tmuxPath, ["set-option", "-w", "-t", windowTarget, "pane-border-status", "top"])

    const panesByMember: Record<string, string> = {}

    for (const member of members) {
      const paneId = await createTeammatePaneInCurrentWindow(tmuxPath, leaderPaneId, windowTarget, member)
      if (paneId) panesByMember[member.name] = paneId
    }

    if (Object.keys(panesByMember).length === 0) return null

    for (const member of members) {
      const paneId = panesByMember[member.name]
      if (!paneId) continue
      const cmd = buildAttachCommand(member, serverUrl)
      await runTmuxCommand(tmuxPath, ["send-keys", "-t", paneId, cmd, "Enter"])
    }

    return {
      focusWindowId: windowId,
      gridWindowId: windowId,
      focusPanesByMember: panesByMember,
      gridPanesByMember: panesByMember,
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

    if (cleanupTarget.paneIds && cleanupTarget.paneIds.length > 0) {
      for (const paneId of cleanupTarget.paneIds) {
        try {
          await runTmuxCommand(tmuxPath, ["kill-pane", "-t", paneId])
        } catch {
          log("tmux team pane cleanup failed", { teamRunId, paneId })
        }
      }

      const leaderPaneId = process.env.TMUX_PANE
      if (leaderPaneId) {
        const windowTarget = await resolveCurrentWindowTarget(tmuxPath, leaderPaneId)
        if (windowTarget) await rebalanceWithLeader(tmuxPath, windowTarget, leaderPaneId)
      }
      return
    }

    const leaderPaneId = process.env.TMUX_PANE
    const leaderWindowId = leaderPaneId
      ? await resolveCurrentWindowId(tmuxPath, leaderPaneId)
      : null

    for (const windowId of [cleanupTarget.focusWindowId, cleanupTarget.gridWindowId]) {
      if (!windowId) continue
      if (leaderWindowId && windowId === leaderWindowId) {
        log("tmux team layout skipping kill-window on leader window", { teamRunId, windowId })
        continue
      }
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
