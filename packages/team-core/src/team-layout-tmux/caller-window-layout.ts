import {
  buildTmuxPaneShellCommand,
  getReadyTmuxPaneEnvironment,
  type TmuxPaneEnvironment,
  type TmuxPaneEnvironmentPlan,
  type TmuxServerAccess,
} from "@oh-my-opencode/tmux-core"

import { shellSingleQuote } from "../shell-quote"
import type {
  TeamLayoutDeps,
  TeamLayoutExecutionTarget,
  TeamLayoutMember,
} from "./layout-types"
import {
  runTeamTmuxCleanupCommand,
  runTeamTmuxCommand,
  runTeamTmuxPaneCreationCommand,
  type TeamCleanupExecution,
} from "./team-tmux-command"

const TEAM_PANE_TITLE_PREFIX = "omo-team-"
const OMO_ATTACH_SERVER_URL_OPTION = "@omo_attach_server_url"
const OMO_ATTACH_SESSION_ID_OPTION = "@omo_attach_session_id"
export const OMO_TEAM_RUN_ID_OPTION = "@omo_team_run_id"

type CreatedTeamPane = {
  readonly cleanupExecution: TeamCleanupExecution
  readonly paneId: string
}

function getPaneWorkingDirectory(member: TeamLayoutMember): string {
  return member.worktreePath ?? process.cwd()
}

function buildAttachCommand(member: TeamLayoutMember, serverUrl: string): string {
  return `opencode attach ${shellSingleQuote(serverUrl)} --session ${shellSingleQuote(member.sessionId)} --dir ${shellSingleQuote(getPaneWorkingDirectory(member))}`
}

function selectExistingTeammatePane(teammatePanes: string[], callerPaneId: string): string {
  return teammatePanes[Math.floor(teammatePanes.length / 2)]
    ?? teammatePanes[teammatePanes.length - 1]
    ?? callerPaneId
}

function buildSplitArgs(
  callerPaneId: string,
  teammatePanes: string[],
  member: TeamLayoutMember,
  environmentPlan: TmuxPaneEnvironmentPlan,
): string[] {
  const target = teammatePanes.length === 0
    ? callerPaneId
    : selectExistingTeammatePane(teammatePanes, callerPaneId)
  const direction = teammatePanes.length === 0
    ? ["-h", "-l", "70%"]
    : [teammatePanes.length % 2 === 1 ? "-v" : "-h"]
  return [
    "split-window",
    ...environmentPlan.args,
    "-t",
    target,
    ...direction,
    "-d",
    "-P",
    "-F",
    "#{pane_id}",
    "-c",
    getPaneWorkingDirectory(member),
    buildTmuxPaneShellCommand(environmentPlan),
  ]
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? "Error" : typeof error
}

async function rollbackCreatedTeamPanes(
  tmuxPath: string,
  createdPanes: readonly CreatedTeamPane[],
  deps: TeamLayoutDeps,
  teamRunId: string,
): Promise<void> {
  for (const { cleanupExecution, paneId } of [...createdPanes].reverse()) {
    try {
      const result = await runTeamTmuxCleanupCommand(
        tmuxPath,
        ["kill-pane", "-t", paneId],
        cleanupExecution,
        deps,
      )
      if (result.success) continue
    } catch (error) {
      deps.log("team pane rollback failed", {
        errorType: getErrorType(error),
        kind: "warning",
        paneId,
        teamRunId,
      })
    }
    deps.log("team pane rollback incomplete", { kind: "warning", paneId, teamRunId })
  }
}

export async function createTeamLayoutInCallerWindow(input: {
  callerPaneId: string
  deps: TeamLayoutDeps
  executionTarget: TeamLayoutExecutionTarget
  members: TeamLayoutMember[]
  paneEnvironment: TmuxPaneEnvironment
  serverAccess: TmuxServerAccess
  teamRunId: string
  tmuxPath: string
  windowTarget: string
}): Promise<{ focusWindowId: string; focusPanesByMember: Record<string, string> } | null> {
  const {
    callerPaneId,
    deps,
    executionTarget,
    members,
    paneEnvironment,
    serverAccess,
    teamRunId,
    tmuxPath,
    windowTarget,
  } = input
  const panesByMember: Record<string, string> = {}
  const createdPanes: CreatedTeamPane[] = []
  let currentPaneEnvironment = paneEnvironment
  const guardedDeps: TeamLayoutDeps = {
    ...deps,
    runTmuxCommand: (path, args) =>
      runTeamTmuxCommand(path, executionTarget, paneEnvironment, deps, teamRunId, () => args),
  }

  try {
    const listed = await guardedDeps.runTmuxCommand(
      tmuxPath,
      ["list-panes", "-t", windowTarget, "-F", "#{pane_id}"],
    )
    if (!listed.success || !listed.output) return null
    let teammatePanes = listed.output.trim().split("\n").filter(Boolean)
      .filter((paneId) => paneId !== callerPaneId)

    for (const [memberIndex, member] of members.entries()) {
      if (memberIndex > 0) {
        const refreshedPaneEnvironment = await getReadyTmuxPaneEnvironment(serverAccess)
        if (!refreshedPaneEnvironment) {
          deps.log("server listener no longer ready; rolling back team layout", {
            kind: "warning",
            teamRunId,
          })
          await rollbackCreatedTeamPanes(tmuxPath, createdPanes, deps, teamRunId)
          return null
        }
        currentPaneEnvironment = refreshedPaneEnvironment
      }
      const split = await runTeamTmuxPaneCreationCommand(
        tmuxPath,
        executionTarget,
        currentPaneEnvironment,
        deps,
        teamRunId,
        (plan) => buildSplitArgs(callerPaneId, teammatePanes, member, plan),
      )
      if (!split.result.success || !split.result.output || !split.cleanupExecution) {
        await rollbackCreatedTeamPanes(tmuxPath, createdPanes, deps, teamRunId)
        return null
      }

      const paneId = split.result.output.trim()
      createdPanes.push({ cleanupExecution: split.cleanupExecution, paneId })
      teammatePanes = [...teammatePanes, paneId]
      panesByMember[member.name] = paneId
      const setupCommands = [
        ["select-pane", "-t", paneId, "-T", `${TEAM_PANE_TITLE_PREFIX}${member.name}`],
        ["set-option", "-p", "-t", paneId, OMO_TEAM_RUN_ID_OPTION, teamRunId],
        ["set-option", "-p", "-t", paneId, OMO_ATTACH_SERVER_URL_OPTION, serverAccess.serverUrl],
        ["set-option", "-p", "-t", paneId, OMO_ATTACH_SESSION_ID_OPTION, member.sessionId],
        ["send-keys", "-t", paneId, buildAttachCommand(member, serverAccess.serverUrl), "Enter"],
      ]
      for (const command of setupCommands) {
        const setup = await runTeamTmuxCommand(
          tmuxPath,
          executionTarget,
          currentPaneEnvironment,
          deps,
          teamRunId,
          () => command,
        )
        if (!setup.success) {
          await rollbackCreatedTeamPanes(tmuxPath, createdPanes, deps, teamRunId)
          return null
        }
      }
    }

    const selected = await runTeamTmuxCommand(
      tmuxPath,
      executionTarget,
      currentPaneEnvironment,
      deps,
      teamRunId,
      () => ["select-layout", "-t", windowTarget, "main-vertical"],
    )
    if (!selected.success) {
      await rollbackCreatedTeamPanes(tmuxPath, createdPanes, deps, teamRunId)
      return null
    }

    try {
      const resized = await runTeamTmuxCommand(
        tmuxPath,
        executionTarget,
        currentPaneEnvironment,
        deps,
        teamRunId,
        () => ["resize-pane", "-t", callerPaneId, "-x", "30%"],
      )
      if (!resized.success) {
        deps.log("team caller pane resize failed; keeping committed layout", { kind: "warning", teamRunId })
      }
    } catch (error) {
      deps.log("team caller pane resize failed; keeping committed layout", {
        errorType: getErrorType(error),
        kind: "warning",
        teamRunId,
      })
    }

    return { focusWindowId: windowTarget, focusPanesByMember: panesByMember }
  } catch (error) {
    await rollbackCreatedTeamPanes(tmuxPath, createdPanes, deps, teamRunId)
    deps.log("team layout command failed", { errorType: getErrorType(error), kind: "warning", teamRunId })
    return null
  }
}
