import { runTmuxCommand } from "../runner"
import { isCmuxCompatEnvironment, resolveStableTmuxBackend } from "../cmux-detect"
import { getReadyTmuxPaneEnvironment, normalizeTmuxServerTarget } from "../tmux-server-target"
import type { TmuxServerTarget } from "../types"
import { isInsideTmux } from "./environment"
import { isServerRunning } from "./server-health"
import {
  applyTmuxPaneEnvironmentToCommand,
  buildTmuxAttachCommand,
  planTmuxPaneEnvironment,
} from "./pane-command"

export type ActivateTmuxPaneDeps = {
  readonly isInsideTmux: () => boolean
  readonly isServerRunning?: typeof isServerRunning
  readonly getTmuxPath: () => Promise<string | null | undefined>
  readonly runTmuxCommand: typeof runTmuxCommand
  readonly log: (message: string, data?: unknown) => void
}

export async function activateTmuxPane(
  paneId: string,
  sessionId: string,
  serverTarget: TmuxServerTarget,
  directory: string,
  deps: ActivateTmuxPaneDeps = {
    isInsideTmux,
    isServerRunning,
    getTmuxPath: async () => null,
    runTmuxCommand,
    log: () => undefined,
  },
): Promise<boolean> {
  const serverAccess = normalizeTmuxServerTarget(serverTarget, deps.isServerRunning)

  if (!deps.isInsideTmux()) {
    deps.log("[activateTmuxPane] SKIP: not inside tmux", { paneId, sessionId })
    return false
  }

  const paneEnvironment = await getReadyTmuxPaneEnvironment(serverAccess)
  if (!paneEnvironment) {
    deps.log("[activateTmuxPane] SKIP: server listener not ready", { paneId, sessionId })
    return false
  }

  const backend = await resolveStableTmuxBackend(deps.getTmuxPath)
  if (!backend) {
    deps.log("[activateTmuxPane] SKIP: tmux backend changed or executable was unavailable", { paneId, sessionId })
    return false
  }

  const environmentPlan = planTmuxPaneEnvironment(paneEnvironment, backend.isCmux)
  if (!environmentPlan) {
    deps.log("[activateTmuxPane] SKIP: pane environment cannot be safely omitted under cmux", { paneId, sessionId })
    return false
  }

  const attachCommand = applyTmuxPaneEnvironmentToCommand(
    buildTmuxAttachCommand(serverAccess.serverUrl, sessionId, directory),
    environmentPlan,
  )
  const result = await deps.runTmuxCommand(backend.path, [
    "respawn-pane",
    "-k",
    ...environmentPlan.args,
    "-t",
    paneId,
    attachCommand,
  ])
  if (result.exitCode !== 0) {
    deps.log("[activateTmuxPane] FAILED", { paneId, sessionId, exitCode: result.exitCode, stderr: result.stderr.trim() })
    return false
  }

  deps.log("[activateTmuxPane] SUCCESS", { paneId, sessionId })
  return true
}
