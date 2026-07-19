import { activateTmuxPane as activateTmuxPaneCore } from "@oh-my-opencode/tmux-core"
import type { ActivateTmuxPaneDeps, TmuxServerTarget } from "@oh-my-opencode/tmux-core"
import { normalizeOpenCodeTmuxServerTarget } from "../opencode-server-access"
import { paneActivateDeps } from "./adapter-deps"

export async function activateTmuxPane(
  paneId: string,
  sessionId: string,
  serverTarget: TmuxServerTarget,
  directory: string,
  depsInput?: Partial<ActivateTmuxPaneDeps>,
): Promise<boolean> {
  return activateTmuxPaneCore(
    paneId,
    sessionId,
    normalizeOpenCodeTmuxServerTarget(serverTarget),
    directory,
    paneActivateDeps(depsInput),
  )
}
