import { runTmuxCommand } from "../runner"
import { isInsideTmux } from "./environment"
import { buildTmuxAttachCommand } from "./pane-command"

export type ActivateTmuxPaneDeps = {
  readonly isInsideTmux: () => boolean
  readonly getTmuxPath: () => Promise<string | null | undefined>
  readonly runTmuxCommand: typeof runTmuxCommand
  readonly log: (message: string, data?: unknown) => void
}

export async function activateTmuxPane(
  paneId: string,
  sessionId: string,
  serverUrl: string,
  directory: string,
  deps: ActivateTmuxPaneDeps = {
    isInsideTmux,
    getTmuxPath: async () => null,
    runTmuxCommand,
    log: () => undefined,
  },
): Promise<boolean> {
  if (!deps.isInsideTmux()) {
    deps.log("[activateTmuxPane] SKIP: not inside tmux", { paneId, sessionId })
    return false
  }

  const tmux = await deps.getTmuxPath()
  if (!tmux) {
    deps.log("[activateTmuxPane] SKIP: tmux not found", { paneId, sessionId })
    return false
  }

  const opencodeCmd = buildTmuxAttachCommand(serverUrl, sessionId, directory)
  const result = await deps.runTmuxCommand(tmux, ["respawn-pane", "-k", "-t", paneId, opencodeCmd])
  if (result.exitCode !== 0) {
    deps.log("[activateTmuxPane] FAILED", { paneId, sessionId, exitCode: result.exitCode, stderr: result.stderr.trim() })
    return false
  }

  deps.log("[activateTmuxPane] SUCCESS", { paneId, sessionId })
  return true
}
