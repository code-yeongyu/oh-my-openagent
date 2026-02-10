import type { TmuxConfig } from "../../config/schema"
import type { TrackedSession } from "./types"
import { log } from "../../shared"
import { queryWindowState } from "./pane-state-querier"
import { executeAction } from "./action-executor"
import { TmuxPollingManager } from "./polling-manager"

export class ManagerCleanup {
  constructor(
    private sessions: Map<string, TrackedSession>,
    private sourcePaneId: string | undefined,
    private pollingManager: TmuxPollingManager,
    private tmuxConfig: TmuxConfig,
    private serverUrl: string
  ) {}

  async cleanup(): Promise<void> {
    this.pollingManager.stopPolling()

    if (this.sessions.size > 0) {
      log("[tmux-session-manager] closing all panes", { count: this.sessions.size })
      const state = this.sourcePaneId ? await queryWindowState(this.sourcePaneId) : null
      
      if (state) {
        const closePromises = Array.from(this.sessions.values()).map((s) =>
          executeAction(
            { type: "close", paneId: s.paneId, sessionId: s.sessionId },
            { config: this.tmuxConfig, serverUrl: this.serverUrl, windowState: state }
          ).catch((err) =>
            log("[tmux-session-manager] cleanup error for pane", {
              paneId: s.paneId,
              error: String(err),
            }),
          ),
        )
        await Promise.all(closePromises)
      }
      this.sessions.clear()
    }

    log("[tmux-session-manager] cleanup complete")
  }
}
