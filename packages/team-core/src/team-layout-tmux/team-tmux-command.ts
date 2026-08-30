import {
  isTmuxPathCompatibleWithBackend,
  normalizeTmuxServerTarget,
  planTmuxPaneEnvironment,
  TMUX_BACKEND_MISMATCH_ERROR,
  TMUX_PANE_ENVIRONMENT_UNSAFE_ERROR,
  type TmuxCommandResult,
  type TmuxPaneEnvironment,
  type TmuxPaneEnvironmentPlan,
  type TmuxServerAccess,
} from "@oh-my-opencode/tmux-core"

import type {
  TeamLayoutDeps,
  TeamLayoutExecutionTarget,
  TmuxSessionManager,
} from "./layout-types"
import {
  captureTeamLayoutExecutionTarget,
  matchesTeamLayoutExecutionTarget,
} from "./execution-target"

export {
  captureTeamLayoutExecutionTarget,
  matchesTeamLayoutExecutionTarget,
} from "./execution-target"

export type TeamCleanupExecution = {
  readonly environment: Readonly<Record<string, string | undefined>>
}

export function createTeamCleanupExecution(
  target: TeamLayoutExecutionTarget,
  paneEnvironment: TmuxPaneEnvironment,
  ambientEnvironment: Readonly<Record<string, string | undefined>> = process.env,
): TeamCleanupExecution {
  const environment = { ...ambientEnvironment }
  delete environment.TMUX
  delete environment.CMUX_SOCKET_PATH
  for (const name of Object.keys(paneEnvironment)) {
    delete environment[name]
  }
  if (target.tmuxEnvironment !== undefined) {
    environment.TMUX = target.tmuxEnvironment
  }
  if (target.backend === "cmux" && target.cmuxSocketPath !== undefined) {
    environment.CMUX_SOCKET_PATH = target.cmuxSocketPath
  }
  return { environment }
}

export function resolveTmuxServerAccess(
  tmuxMgr: TmuxSessionManager,
  deps: TeamLayoutDeps,
): TmuxServerAccess {
  const serverAccess = tmuxMgr.getTmuxServerAccess?.()
  return serverAccess ?? normalizeTmuxServerTarget(tmuxMgr.getServerUrl(), deps.isServerRunning)
}

export function blockedTmuxCommandResult(
  stderr = TMUX_PANE_ENVIRONMENT_UNSAFE_ERROR,
): TmuxCommandResult {
  return {
    success: false,
    output: "",
    stdout: "",
    stderr,
    exitCode: 1,
  }
}

function getEnvironment(deps: TeamLayoutDeps): Readonly<Record<string, string | undefined>> {
  return deps.getEnvironment?.() ?? process.env
}

function targetIsCmux(target: TeamLayoutExecutionTarget): boolean {
  return target.backend === "cmux"
}

export function runTeamTmuxCommand(
  tmuxPath: string,
  target: TeamLayoutExecutionTarget,
  paneEnvironment: TmuxPaneEnvironment,
  deps: TeamLayoutDeps,
  teamRunId: string,
  buildArgs: (environmentPlan: TmuxPaneEnvironmentPlan) => Array<string>,
): Promise<TmuxCommandResult> {
  const isCmux = targetIsCmux(target)
  if (
    !matchesTeamLayoutExecutionTarget(target, getEnvironment(deps))
    || !isTmuxPathCompatibleWithBackend(tmuxPath, isCmux)
  ) {
    deps.log("tmux backend no longer matches the captured execution target, skipping team layout", {
      kind: "warning",
      teamRunId,
    })
    return Promise.resolve(blockedTmuxCommandResult(TMUX_BACKEND_MISMATCH_ERROR))
  }
  if (!isCmux) {
    return deps.runTmuxCommand(tmuxPath, buildArgs({
      args: [],
      clearedNames: [],
      isCmux: false,
    }))
  }
  const environmentPlan = planTmuxPaneEnvironment(paneEnvironment, isCmux)
  if (!environmentPlan) {
    deps.log("pane environment cannot be applied safely, skipping team layout", {
      kind: "warning",
      teamRunId,
    })
    return Promise.resolve(blockedTmuxCommandResult())
  }
  return deps.runTmuxCommand(tmuxPath, buildArgs(environmentPlan))
}

export async function runTeamTmuxPaneCreationCommand(
  tmuxPath: string,
  target: TeamLayoutExecutionTarget,
  paneEnvironment: TmuxPaneEnvironment,
  deps: TeamLayoutDeps,
  teamRunId: string,
  buildArgs: (environmentPlan: TmuxPaneEnvironmentPlan) => Array<string>,
): Promise<{ cleanupExecution?: TeamCleanupExecution; result: TmuxCommandResult }> {
  const environment = getEnvironment(deps)
  const isCmux = targetIsCmux(target)
  if (
    !matchesTeamLayoutExecutionTarget(target, environment)
    || !isTmuxPathCompatibleWithBackend(tmuxPath, isCmux)
  ) {
    deps.log("tmux backend no longer matches the captured execution target, skipping team layout", {
      kind: "warning",
      teamRunId,
    })
    return { result: blockedTmuxCommandResult(TMUX_BACKEND_MISMATCH_ERROR) }
  }

  const environmentPlan = planTmuxPaneEnvironment(paneEnvironment, isCmux)
  if (!environmentPlan) {
    deps.log("pane environment cannot be applied safely, skipping team layout", {
      kind: "warning",
      teamRunId,
    })
    return { result: blockedTmuxCommandResult() }
  }

  const cleanupExecution = createTeamCleanupExecution(target, paneEnvironment, environment)
  const result = await deps.runTmuxCommand(tmuxPath, buildArgs(environmentPlan))
  return { cleanupExecution, result }
}

export function runTeamTmuxCleanupCommand(
  tmuxPath: string,
  args: Array<string>,
  cleanupExecution: TeamCleanupExecution,
  deps: TeamLayoutDeps,
): Promise<TmuxCommandResult> {
  return deps.runTmuxCommand(tmuxPath, args, cleanupExecution)
}

export async function resolveCleanupTmuxPath(
  target: TeamLayoutExecutionTarget,
  getTmuxPath: TeamLayoutDeps["getTmuxPath"],
  getTmuxPathForBackend?: TeamLayoutDeps["getTmuxPathForBackend"],
): Promise<string | null> {
  const resolvedPath = getTmuxPathForBackend
    ? await getTmuxPathForBackend(target.backend)
    : await getTmuxPath()
  if (!resolvedPath) return null
  const isCmux = targetIsCmux(target)
  const path = isCmux && resolvedPath === "tmux" ? "cmux" : resolvedPath
  return isTmuxPathCompatibleWithBackend(path, isCmux) ? path : null
}
