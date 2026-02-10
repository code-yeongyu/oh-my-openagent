import type { TmuxConfig } from "../../config/schema"
import { log } from "../../shared"
import type { TrackedSession } from "./types"
import { queryWindowState } from "./pane-state-querier"
import { executeAction } from "./action-executor"

export async function cleanupTmuxSessions(params: {
  tmuxConfig: TmuxConfig
  serverUrl: string
  sourcePaneId: string | undefined
  sessions: Map<string, TrackedSession>
  stopPolling: () => void
}): Promise<void> {
  params.stopPolling()

  if (params.sessions.size === 0) {
    log("[tmux-session-manager] cleanup complete")
    return
  }

  log("[tmux-session-manager] closing all panes", { count: params.sessions.size })
  const state = params.sourcePaneId ? await queryWindowState(params.sourcePaneId) : null

  if (state) {
    const closePromises = Array.from(params.sessions.values()).map((tracked) =>
      executeAction(
        { type: "close", paneId: tracked.paneId, sessionId: tracked.sessionId },
        { config: params.tmuxConfig, serverUrl: params.serverUrl, windowState: state },
      ).catch((error) =>
        log("[tmux-session-manager] cleanup error for pane", {
          paneId: tracked.paneId,
          error: String(error),
        }),
      ),
    )

    await Promise.all(closePromises)
  }

  params.sessions.clear()
  log("[tmux-session-manager] cleanup complete")
}
