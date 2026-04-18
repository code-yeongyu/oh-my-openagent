import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"
import { log } from "../../logger"
import { runTmuxCommand } from "../runner"
import { isInsideTmux } from "./environment"
import { buildTmuxAttachCommand } from "./pane-command"

export async function activateTmuxPane(
  paneId: string,
  sessionId: string,
  serverUrl: string,
  directory: string,
): Promise<boolean> {
  if (!isInsideTmux()) {
    log("[activateTmuxPane] SKIP: not inside tmux", { paneId, sessionId })
    return false
  }

  const tmux = await getTmuxPath()
  if (!tmux) {
    log("[activateTmuxPane] SKIP: tmux not found", { paneId, sessionId })
    return false
  }

  const opencodeCmd = buildTmuxAttachCommand(serverUrl, sessionId, directory)
  const result = await runTmuxCommand(tmux, ["respawn-pane", "-k", "-t", paneId, opencodeCmd])
  if (result.exitCode !== 0) {
    log("[activateTmuxPane] FAILED", { paneId, sessionId, exitCode: result.exitCode, stderr: result.stderr.trim() })
    return false
  }

  log("[activateTmuxPane] SUCCESS", { paneId, sessionId })
  return true
}
