import type { TmuxConfig } from "../../config/schema"
import type { TrackedSession } from "./types"
import { log } from "../../shared"
import { queryWindowState } from "./pane-state-querier"
import { decideCloseAction, type SessionMapping } from "./decision-engine"
import { executeAction } from "./action-executor"

export interface SessionDeletedHandlerDeps {
  tmuxConfig: TmuxConfig
  serverUrl: string
  sourcePaneId: string | undefined
  sessions: Map<string, TrackedSession>
  isEnabled: () => boolean
  getSessionMappings: () => SessionMapping[]
  stopPolling: () => void
}

export async function handleSessionDeleted(
  deps: SessionDeletedHandlerDeps,
  event: { sessionID: string },
): Promise<void> {
  if (!deps.isEnabled()) return
  if (!deps.sourcePaneId) return

  const tracked = deps.sessions.get(event.sessionID)
  if (!tracked) return

  log("[tmux-session-manager] onSessionDeleted", { sessionId: event.sessionID })

  const state = await queryWindowState(deps.sourcePaneId)
  if (!state) {
    deps.sessions.delete(event.sessionID)
    return
  }

  const closeAction = decideCloseAction(state, event.sessionID, deps.getSessionMappings())
  if (closeAction) {
    await executeAction(closeAction, {
      config: deps.tmuxConfig,
      serverUrl: deps.serverUrl,
      windowState: state,
    })
  }

  deps.sessions.delete(event.sessionID)

  if (deps.sessions.size === 0) {
    deps.stopPolling()
  }
}
