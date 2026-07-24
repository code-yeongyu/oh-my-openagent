import { runTmuxCommand } from "../runner"
import { isCmuxCompatEnvironment, resolveStableTmuxBackend } from "../cmux-detect"
import { normalizeTmuxServerTarget } from "../tmux-server-target"
import type { TmuxServerTarget } from "../types"
import { isInsideTmux } from "./environment"
import { buildTmuxAttachCommand, planTmuxPaneEnvironment } from "./pane-command"

export type ActivateTmuxPaneDeps = {
  readonly isInsideTmux: () => boolean
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
    getTmuxPath: async () => null,
    runTmuxCommand,
    log: () => undefined,
  },
): Promise<boolean> {
  const serverAccess = normalizeTmuxServerTarget(serverTarget)

  if (!deps.isInsideTmux()) {
    deps.log("[activateTmuxPane] SKIP: not inside tmux", { paneId, sessionId })
    return false
  }

  const backend = await resolveStableTmuxBackend(deps.getTmuxPath)
  if (!backend) {
    deps.log("[activateTmuxPane] SKIP: tmux backend changed or executable was unavailable", { paneId, sessionId })
    return false
  }

  const environmentPlan = planTmuxPaneEnvironment(serverAccess.getPaneEnvironment(), backend.isCmux)
  if (!environmentPlan) {
    deps.log("[activateTmuxPane] SKIP: pane environment cannot be safely omitted under cmux", { paneId, sessionId })
    return false
  }

  const attachCommand = buildTmuxAttachCommand(serverAccess.serverUrl, sessionId, directory)
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
