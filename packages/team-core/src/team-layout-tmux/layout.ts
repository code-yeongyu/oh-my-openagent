import {
  getHttpServerOriginForLog,
  isCmuxCompatEnvironment,
  isTmuxPathCompatibleWithBackend,
  isServerRunning,
  normalizeTmuxServerTarget,
  planTmuxPaneEnvironment,
  resolveStableTmuxBackend,
  runTmuxCommand,
  TMUX_BACKEND_MISMATCH_ERROR,
  TMUX_PANE_ENVIRONMENT_UNSAFE_ERROR,
  type RunTmuxOptions,
  type TmuxCommandResult,
  type TmuxServerAccess,
} from "@oh-my-opencode/tmux-core"
import { log } from "../logger"
import { shellSingleQuote } from "../shell-quote"
import { resolveCallerTmuxSession } from "./resolve-caller-tmux-session"

type TeamLayoutMember = { name: string; sessionId: string; worktreePath?: string }
type TmuxSessionManager = {
  getServerUrl: () => string
  getCtxServerUrl?: () => string | undefined
  getTmuxServerAccess?: () => TmuxServerAccess | undefined
}
const TEAM_PANE_TITLE_PREFIX = "omo-team-"
const OMO_ATTACH_SERVER_URL_OPTION = "@omo_attach_server_url"
const OMO_ATTACH_SESSION_ID_OPTION = "@omo_attach_session_id"

export type TeamLayoutDeps = {
  runTmuxCommand: (tmuxPath: string, args: Array<string>, options?: RunTmuxOptions) => Promise<TmuxCommandResult>
  isServerRunning: typeof isServerRunning
  getTmuxPath: () => Promise<string | null | undefined>
  resolveCallerTmuxSession: typeof resolveCallerTmuxSession
  log: typeof log
  isCmuxCompatEnvironment?: typeof isCmuxCompatEnvironment
}

const defaultDeps: TeamLayoutDeps = {
  runTmuxCommand,
  isServerRunning,
  getTmuxPath: async () => "tmux",
  resolveCallerTmuxSession,
  log,
  isCmuxCompatEnvironment,
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

type TeamCleanupExecution = {
  readonly environment: Readonly<Record<string, string | undefined>>
}

type CreatedTeamPane = {
  readonly cleanupExecution: TeamCleanupExecution
  readonly paneId: string
}

export function canVisualize(): boolean {
  return process.env.TMUX !== undefined || isCmuxCompatEnvironment()
}

function getPaneWorkingDirectory(member: TeamLayoutMember): string {
  return member.worktreePath ?? process.cwd()
}

function buildAttachCommand(member: TeamLayoutMember, serverUrl: string): string {
  return `opencode attach ${shellSingleQuote(serverUrl)} --session ${shellSingleQuote(member.sessionId)} --dir ${shellSingleQuote(getPaneWorkingDirectory(member))}`
}

function resolveTmuxServerAccess(tmuxMgr: TmuxSessionManager, deps: TeamLayoutDeps): TmuxServerAccess {
  const serverAccess = tmuxMgr.getTmuxServerAccess?.()
  return serverAccess ?? normalizeTmuxServerTarget(tmuxMgr.getServerUrl(), deps.isServerRunning)
}

async function listPanesInWindow(tmuxPath: string, windowTarget: string, deps: TeamLayoutDeps): Promise<Array<string> | null> {
  const result = await deps.runTmuxCommand(tmuxPath, ["list-panes", "-t", windowTarget, "-F", "#{pane_id}"])
  if (!result.success || !result.output) return null
  return result.output.trim().split("\n").filter(Boolean)
}

function selectExistingTeammatePane(teammatePanes: Array<string>, callerPaneId: string): string {
  return teammatePanes[Math.floor(teammatePanes.length / 2)] ?? teammatePanes[teammatePanes.length - 1] ?? callerPaneId
}

function buildSplitArgs(
  callerPaneId: string,
  teammatePanes: Array<string>,
  member: TeamLayoutMember,
  environmentArgs: string[],
): Array<string> {
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

function blockedTmuxCommandResult(stderr = TMUX_PANE_ENVIRONMENT_UNSAFE_ERROR): TmuxCommandResult {
  return {
    success: false,
    output: "",
    stdout: "",
    stderr,
    exitCode: 1,
  }
}

function runTeamTmuxCommand(
  tmuxPath: string,
  expectedIsCmux: boolean,
  serverAccess: TmuxServerAccess,
  detectCmux: typeof isCmuxCompatEnvironment,
  deps: TeamLayoutDeps,
  teamRunId: string,
  buildArgs: (environmentArgs: string[]) => Array<string>,
): Promise<TmuxCommandResult> {
  const isCmux = detectCmux()
  if (isCmux !== expectedIsCmux || !isTmuxPathCompatibleWithBackend(tmuxPath, isCmux)) {
    deps.log("tmux backend no longer matches the resolved executable, skipping team layout", {
      kind: "warning",
      teamRunId,
    })
    return Promise.resolve(blockedTmuxCommandResult(TMUX_BACKEND_MISMATCH_ERROR))
  }
  if (!isCmux) {
    return deps.runTmuxCommand(tmuxPath, buildArgs([]))
  }
  const environmentPlan = planTmuxPaneEnvironment(serverAccess.getPaneEnvironment(), isCmux)
  if (!environmentPlan) {
    deps.log("pane environment cannot be safely omitted under cmux, skipping team layout", {
      kind: "warning",
      teamRunId,
    })
    return Promise.resolve(blockedTmuxCommandResult())
  }
  return deps.runTmuxCommand(tmuxPath, buildArgs(environmentPlan.args))
}

function buildCleanupProcessEnvironment(
  paneEnvironment: Readonly<Record<string, string>>,
  ambientEnvironment: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string | undefined> {
  const environment = { ...ambientEnvironment }
  for (const name of Object.keys(paneEnvironment)) {
    delete environment[name]
  }
  return environment
}

function createTeamCleanupExecution(
  paneEnvironment: Readonly<Record<string, string>>,
): TeamCleanupExecution {
  return {
    environment: buildCleanupProcessEnvironment(paneEnvironment),
  }
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? "Error" : typeof error
}

async function runTeamTmuxPaneCreationCommand(
  tmuxPath: string,
  expectedIsCmux: boolean,
  serverAccess: TmuxServerAccess,
  detectCmux: typeof isCmuxCompatEnvironment,
  deps: TeamLayoutDeps,
  teamRunId: string,
  buildArgs: (environmentArgs: string[]) => Array<string>,
): Promise<{ cleanupExecution?: TeamCleanupExecution; result: TmuxCommandResult }> {
  const isCmux = detectCmux()
  if (isCmux !== expectedIsCmux || !isTmuxPathCompatibleWithBackend(tmuxPath, isCmux)) {
    deps.log("tmux backend no longer matches the resolved executable, skipping team layout", {
      kind: "warning",
      teamRunId,
    })
    return {
      result: blockedTmuxCommandResult(TMUX_BACKEND_MISMATCH_ERROR),
    }
  }

  const paneEnvironment = serverAccess.getPaneEnvironment()
  const environmentPlan = planTmuxPaneEnvironment(paneEnvironment, isCmux)
  if (!environmentPlan) {
    deps.log("pane environment cannot be safely omitted under cmux, skipping team layout", {
      kind: "warning",
      teamRunId,
    })
    return { result: blockedTmuxCommandResult() }
  }

  const cleanupExecution = createTeamCleanupExecution(paneEnvironment)
  const result = await deps.runTmuxCommand(tmuxPath, buildArgs(environmentPlan.args))
  return { cleanupExecution, result }
}

function runTeamTmuxCleanupCommand(
  tmuxPath: string,
  paneId: string,
  cleanupExecution: TeamCleanupExecution,
  deps: TeamLayoutDeps,
): Promise<TmuxCommandResult> {
  return deps.runTmuxCommand(
    tmuxPath,
    ["kill-pane", "-t", paneId],
    cleanupExecution,
  )
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
        paneId,
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
    deps.log("team pane rollback incomplete", {
      kind: "warning",
      paneId,
      teamRunId,
    })
  }
}

async function createTeamLayoutInCallerWindow(
  teamRunId: string,
  tmuxPath: string,
  expectedIsCmux: boolean,
  callerPaneId: string,
  windowTarget: string,
  members: Array<TeamLayoutMember>,
  serverAccess: TmuxServerAccess,
  detectCmux: typeof isCmuxCompatEnvironment,
  deps: TeamLayoutDeps,
): Promise<{ focusWindowId: string; focusPanesByMember: Record<string, string> } | null> {
  const panesByMember: Record<string, string> = {}
  const createdPanes: CreatedTeamPane[] = []
  const guardedDeps: TeamLayoutDeps = {
    ...deps,
    runTmuxCommand: (path, args) =>
      runTeamTmuxCommand(path, expectedIsCmux, serverAccess, detectCmux, deps, teamRunId, () => args),
  }
  try {
    const existingPanes = await listPanesInWindow(tmuxPath, windowTarget, guardedDeps)
    if (!existingPanes) return null
    let teammatePanes = existingPanes.filter((paneId) => paneId !== callerPaneId)

    for (const member of members) {
      const split = await runTeamTmuxPaneCreationCommand(
        tmuxPath,
        expectedIsCmux,
        serverAccess,
        detectCmux,
        deps,
        teamRunId,
        (environmentArgs) => buildSplitArgs(callerPaneId, teammatePanes, member, environmentArgs),
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
        ["set-option", "-p", "-t", paneId, OMO_ATTACH_SERVER_URL_OPTION, serverAccess.serverUrl],
        ["set-option", "-p", "-t", paneId, OMO_ATTACH_SESSION_ID_OPTION, member.sessionId],
        ["send-keys", "-t", paneId, buildAttachCommand(member, serverAccess.serverUrl), "Enter"],
      ]
      for (const command of setupCommands) {
        const setupResult = await runTeamTmuxCommand(
          tmuxPath,
          expectedIsCmux,
          serverAccess,
          detectCmux,
          deps,
          teamRunId,
          () => command,
        )
        if (!setupResult.success) {
          await rollbackCreatedTeamPanes(tmuxPath, createdPanes, deps, teamRunId)
          return null
        }
      }
    }

    const layoutResult = await runTeamTmuxCommand(tmuxPath, expectedIsCmux, serverAccess, detectCmux, deps, teamRunId, () =>
      ["select-layout", "-t", windowTarget, "main-vertical"])
    if (!layoutResult.success) {
      await rollbackCreatedTeamPanes(tmuxPath, createdPanes, deps, teamRunId)
      return null
    }

    const resizeResult = await runTeamTmuxCommand(tmuxPath, expectedIsCmux, serverAccess, detectCmux, deps, teamRunId, () =>
      ["resize-pane", "-t", callerPaneId, "-x", "30%"])
    if (!resizeResult.success) {
      await rollbackCreatedTeamPanes(tmuxPath, createdPanes, deps, teamRunId)
      return null
    }

    return { focusWindowId: windowTarget, focusPanesByMember: panesByMember }
  } catch (error) {
    await rollbackCreatedTeamPanes(tmuxPath, createdPanes, deps, teamRunId)
    deps.log("team layout command failed", {
      errorType: getErrorType(error),
      kind: "warning",
      teamRunId,
    })
    return null
  }
}

export async function createTeamLayout(teamRunId: string, members: Array<TeamLayoutMember>, tmuxMgr: TmuxSessionManager, deps: TeamLayoutDeps = defaultDeps): Promise<TeamLayoutResult | null> {
  if (!canVisualize()) {
    deps.log("tmux visualization unavailable, skipping")
    return null
  }
  if (members.length === 0) {
    return null
  }

  const detectCmux = deps.isCmuxCompatEnvironment ?? isCmuxCompatEnvironment

  try {
    const serverAccess = resolveTmuxServerAccess(tmuxMgr, deps)
    if (!(await serverAccess.checkServerHealth())) {
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

    const backend = await resolveStableTmuxBackend(deps.getTmuxPath, detectCmux)
    if (!backend) {
      deps.log("tmux backend changed or executable was unavailable, skipping")
      return null
    }
    const tmuxPath = backend.path

    const callerSession = await deps.resolveCallerTmuxSession(
      tmuxPath,
      process.env.TMUX_PANE,
      (path, args) => runTeamTmuxCommand(
        path,
        backend.isCmux,
        serverAccess,
        detectCmux,
        deps,
        teamRunId,
        () => args,
      ),
    )
    if (!callerSession) {
      deps.log("tmux visualization requires a resolvable caller tmux pane, skipping", { teamRunId })
      return null
    }

    const focus = await createTeamLayoutInCallerWindow(
      teamRunId,
      tmuxPath,
      backend.isCmux,
      callerSession.paneId,
      callerSession.windowTarget,
      members,
      serverAccess,
      detectCmux,
      deps,
    )
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
    deps.log("tmux visualization unavailable, skipping", { errorType: getErrorType(error) })
    return null
  }
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
    const detectCmux = resolvedDeps.isCmuxCompatEnvironment ?? isCmuxCompatEnvironment
    const backend = await resolveStableTmuxBackend(resolvedDeps.getTmuxPath, detectCmux)
    if (!backend) return
    const tmuxPath = backend.path
    const tmuxMgr = isTeamLayoutDeps(tmuxMgrOrDeps) ? undefined : tmuxMgrOrDeps
    const paneEnvironment = tmuxMgr
      ? resolveTmuxServerAccess(tmuxMgr, resolvedDeps).getPaneEnvironment()
      : {}
    const cleanupExecution = createTeamCleanupExecution(paneEnvironment)

    const cleanupTarget = isTeamLayoutCleanupTarget(tmuxMgrOrCleanupTarget)
      ? tmuxMgrOrCleanupTarget
      : undefined

    if (cleanupTarget?.ownedSession !== false) {
      await resolvedDeps.runTmuxCommand(
        tmuxPath,
        ["kill-session", "-t", cleanupTarget?.targetSessionId ?? `omo-team-${teamRunId}`],
        cleanupExecution,
      )
      return
    }

    if (cleanupTarget?.paneIds && cleanupTarget.paneIds.length > 0) {
      for (const paneId of cleanupTarget.paneIds) {
        try {
          await resolvedDeps.runTmuxCommand(tmuxPath, ["kill-pane", "-t", paneId], cleanupExecution)
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
        await resolvedDeps.runTmuxCommand(tmuxPath, ["kill-window", "-t", windowId], cleanupExecution)
      } catch (windowError) {
        resolvedDeps.log("tmux team layout window cleanup failed", {
          teamRunId,
          windowId,
          errorType: getErrorType(windowError),
        })
      }
    }
  } catch (error) {
    resolvedDeps.log("tmux team layout cleanup failed", {
      teamRunId,
      errorType: getErrorType(error),
    })
  }
}

function isTeamLayoutDeps(value: TmuxSessionManager | TeamLayoutDeps | undefined): value is TeamLayoutDeps {
  return value !== undefined && "runTmuxCommand" in value && "getTmuxPath" in value
}

function isTeamLayoutCleanupTarget(value: TmuxSessionManager | TeamLayoutCleanupTarget | undefined): value is TeamLayoutCleanupTarget {
  return value !== undefined && "ownedSession" in value && "targetSessionId" in value
}
