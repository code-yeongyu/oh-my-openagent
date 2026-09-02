import type { TmuxCommandResult } from "@oh-my-opencode/tmux-core"
import type { log } from "../logger"
import { shellSingleQuote } from "../shell-quote"

const TEAM_PANE_TITLE_PREFIX = "omo-team-"
const OMO_ATTACH_SERVER_URL_OPTION = "@omo_attach_server_url"
const OMO_ATTACH_SESSION_ID_OPTION = "@omo_attach_session_id"

export type TeamLayoutMember = { name: string; sessionId: string; worktreePath?: string }

type CallerWindowLayoutDeps = {
  runTmuxCommand: (
    tmuxPath: string,
    args: string[],
    options?: { retry?: number; timeoutMs?: number },
  ) => Promise<TmuxCommandResult>
  log: typeof log
}

function getPaneWorkingDirectory(member: TeamLayoutMember): string {
  return member.worktreePath ?? process.cwd()
}

function buildAttachCommand(member: TeamLayoutMember, serverUrl: string): string {
  return `opencode attach ${shellSingleQuote(serverUrl)} --session ${shellSingleQuote(member.sessionId)} --dir ${shellSingleQuote(getPaneWorkingDirectory(member))}`
}

function buildPaneEnvironmentArgs(): string[] {
  const password = process.env.OPENCODE_SERVER_PASSWORD
  if (!password) return []

  const environmentArgs = ["-e", `OPENCODE_SERVER_PASSWORD=${password}`]
  const username = process.env.OPENCODE_SERVER_USERNAME
  if (username !== undefined) {
    environmentArgs.push("-e", `OPENCODE_SERVER_USERNAME=${username}`)
  }
  return environmentArgs
}

async function listPanesInWindow(
  tmuxPath: string,
  windowTarget: string,
  deps: CallerWindowLayoutDeps,
): Promise<string[]> {
  const result = await deps.runTmuxCommand(tmuxPath, ["list-panes", "-t", windowTarget, "-F", "#{pane_id}"])
  if (!result.success || !result.output) return []
  return result.output.trim().split("\n").filter(Boolean)
}

function selectExistingTeammatePane(teammatePanes: string[], callerPaneId: string): string {
  return teammatePanes[Math.floor(teammatePanes.length / 2)]
    ?? teammatePanes[teammatePanes.length - 1]
    ?? callerPaneId
}

function buildSplitArgs(callerPaneId: string, teammatePanes: string[], member: TeamLayoutMember): string[] {
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

async function cleanupCreatedPanes(
  teamRunId: string,
  tmuxPath: string,
  paneIds: readonly string[],
  deps: CallerWindowLayoutDeps,
): Promise<void> {
  for (const paneId of paneIds) {
    try {
      const cleanup = await deps.runTmuxCommand(tmuxPath, ["kill-pane", "-t", paneId])
      if (!cleanup.success) deps.log("tmux team pane cleanup failed", { teamRunId, paneId })
    } catch {
      deps.log("tmux team pane cleanup failed", { teamRunId, paneId })
    }
  }
}

export async function createCallerWindowTeamLayout(
  teamRunId: string,
  tmuxPath: string,
  callerPaneId: string,
  windowTarget: string,
  members: TeamLayoutMember[],
  serverUrl: string,
  deps: CallerWindowLayoutDeps,
): Promise<{ focusWindowId: string; focusPanesByMember: Record<string, string> } | null> {
  const panesByMember: Record<string, string> = {}
  const existingPanes = await listPanesInWindow(tmuxPath, windowTarget, deps)
  let teammatePanes = existingPanes.filter((paneId) => paneId !== callerPaneId)
  const createdPaneIds: string[] = []

  try {
    for (const member of members) {
      const split = await deps.runTmuxCommand(tmuxPath, buildSplitArgs(callerPaneId, teammatePanes, member))
      if (!split.success || !split.output) {
        await cleanupCreatedPanes(teamRunId, tmuxPath, createdPaneIds, deps)
        return null
      }

      const paneId = split.output.trim()
      createdPaneIds.push(paneId)
      teammatePanes = [...teammatePanes, paneId]
      panesByMember[member.name] = paneId
      const setupCommands = [
        ["select-pane", "-t", paneId, "-T", `${TEAM_PANE_TITLE_PREFIX}${member.name}`],
        ["set-option", "-p", "-t", paneId, OMO_ATTACH_SERVER_URL_OPTION, serverUrl],
        ["set-option", "-p", "-t", paneId, OMO_ATTACH_SESSION_ID_OPTION, member.sessionId],
        ["send-keys", "-t", paneId, buildAttachCommand(member, serverUrl), "Enter"],
      ]
      for (const command of setupCommands) {
        if (!(await deps.runTmuxCommand(tmuxPath, command)).success) {
          await cleanupCreatedPanes(teamRunId, tmuxPath, createdPaneIds, deps)
          return null
        }
      }
    }

    const layout = await deps.runTmuxCommand(tmuxPath, ["select-layout", "-t", windowTarget, "main-vertical"])
    if (!layout.success) {
      await cleanupCreatedPanes(teamRunId, tmuxPath, createdPaneIds, deps)
      return null
    }
    const resize = await deps.runTmuxCommand(tmuxPath, ["resize-pane", "-t", callerPaneId, "-x", "30%"])
    if (!resize.success) {
      await cleanupCreatedPanes(teamRunId, tmuxPath, createdPaneIds, deps)
      return null
    }
    return { focusWindowId: windowTarget, focusPanesByMember: panesByMember }
  } catch (error) {
    await cleanupCreatedPanes(teamRunId, tmuxPath, createdPaneIds, deps)
    throw error
  }
}
