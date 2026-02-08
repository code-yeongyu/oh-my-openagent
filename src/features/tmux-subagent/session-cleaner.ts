import type { TmuxConfig } from "../../config/schema"
import type { TrackedSession } from "./types"
import type { SessionMapping } from "./decision-engine"
import { log } from "../../shared"
import { queryWindowState } from "./pane-state-querier"
import { decideCloseAction } from "./decision-engine"
import { executeAction } from "./action-executor"
import { TmuxPollingManager } from "./polling-manager"

export interface TmuxUtilDeps {
  isInsideTmux: () => boolean
  getCurrentPaneId: () => string | undefined
}

export class SessionCleaner {
  constructor(
    private tmuxConfig: TmuxConfig,
    private deps: TmuxUtilDeps,
    private sessions: Map<string, TrackedSession>,
    private sourcePaneId: string | undefined,
    private getSessionMappings: () => SessionMapping[],
    private pollingManager: TmuxPollingManager,
    private serverUrl: string
  ) {}

  private isEnabled(): boolean {
    return this.tmuxConfig.enabled && this.deps.isInsideTmux()
  }

  async onSessionDeleted(event: { sessionID: string }): Promise<void> {
    if (!this.isEnabled()) return
    if (!this.sourcePaneId) return

    const tracked = this.sessions.get(event.sessionID)
    if (!tracked) return

    log("[tmux-session-manager] onSessionDeleted", { sessionId: event.sessionID })

    const state = await queryWindowState(this.sourcePaneId)
    if (!state) {
      this.sessions.delete(event.sessionID)
      return
    }

    const closeAction = decideCloseAction(state, event.sessionID, this.getSessionMappings())
    if (closeAction) {
      await executeAction(closeAction, { config: this.tmuxConfig, serverUrl: this.serverUrl, windowState: state })
    }

    this.sessions.delete(event.sessionID)

    if (this.sessions.size === 0) {
      this.pollingManager.stopPolling()
    }
  }

  async closeSessionById(sessionId: string): Promise<void> {
    const tracked = this.sessions.get(sessionId)
    if (!tracked) return

    log("[tmux-session-manager] closing session pane", {
      sessionId,
      paneId: tracked.paneId,
    })

    const state = this.sourcePaneId ? await queryWindowState(this.sourcePaneId) : null
    if (state) {
      await executeAction(
        { type: "close", paneId: tracked.paneId, sessionId },
        { config: this.tmuxConfig, serverUrl: this.serverUrl, windowState: state }
      )
    }

    this.sessions.delete(sessionId)

    if (this.sessions.size === 0) {
      this.pollingManager.stopPolling()
    }
  }
}
