import type { PluginInput } from "@opencode-ai/plugin"
import type { TmuxConfig } from "../../config/schema"
import type { CapacityConfig, TrackedSession } from "./types"
import { log } from "../../shared"
import { queryWindowState } from "./pane-state-querier"
import { decideSpawnActions, type SessionMapping } from "./decision-engine"
import { executeActions } from "./action-executor"
import type { SessionCreatedEvent } from "./session-created-event"

type OpencodeClient = PluginInput["client"]

export interface SessionCreatedHandlerDeps {
  client: OpencodeClient
  tmuxConfig: TmuxConfig
  serverUrl: string
  sourcePaneId: string | undefined
  sessions: Map<string, TrackedSession>
  pendingSessions: Set<string>
  isInsideTmux: () => boolean
  isEnabled: () => boolean
  getCapacityConfig: () => CapacityConfig
  getSessionMappings: () => SessionMapping[]
  waitForSessionReady: (sessionId: string) => Promise<boolean>
  startPolling: () => void
}

export async function handleSessionCreated(
  deps: SessionCreatedHandlerDeps,
  event: SessionCreatedEvent,
): Promise<void> {
  const enabled = deps.isEnabled()
  log("[tmux-session-manager] onSessionCreated called", {
    enabled,
    tmuxConfigEnabled: deps.tmuxConfig.enabled,
    isInsideTmux: deps.isInsideTmux(),
    eventType: event.type,
    infoId: event.properties?.info?.id,
    infoParentID: event.properties?.info?.parentID,
  })

  if (!enabled) return
  if (event.type !== "session.created") return

  const info = event.properties?.info
  if (!info?.id || !info?.parentID) return

  const sessionId = info.id
  const title = info.title ?? "Subagent"

  if (deps.sessions.has(sessionId) || deps.pendingSessions.has(sessionId)) {
    log("[tmux-session-manager] session already tracked or pending", { sessionId })
    return
  }

  if (!deps.sourcePaneId) {
    log("[tmux-session-manager] no source pane id")
    return
  }

  deps.pendingSessions.add(sessionId)

  try {
    const state = await queryWindowState(deps.sourcePaneId)
    if (!state) {
      log("[tmux-session-manager] failed to query window state")
      return
    }

    log("[tmux-session-manager] window state queried", {
      windowWidth: state.windowWidth,
      mainPane: state.mainPane?.paneId,
      agentPaneCount: state.agentPanes.length,
      agentPanes: state.agentPanes.map((p) => p.paneId),
    })

    const decision = decideSpawnActions(
      state,
      sessionId,
      title,
      deps.getCapacityConfig(),
      deps.getSessionMappings(),
    )

    log("[tmux-session-manager] spawn decision", {
      canSpawn: decision.canSpawn,
      reason: decision.reason,
      actionCount: decision.actions.length,
      actions: decision.actions.map((a) => {
        if (a.type === "close") return { type: "close", paneId: a.paneId }
        if (a.type === "replace") {
          return { type: "replace", paneId: a.paneId, newSessionId: a.newSessionId }
        }
        return { type: "spawn", sessionId: a.sessionId }
      }),
    })

    if (!decision.canSpawn) {
      log("[tmux-session-manager] cannot spawn", { reason: decision.reason })
      return
    }

    const result = await executeActions(decision.actions, {
      config: deps.tmuxConfig,
      serverUrl: deps.serverUrl,
      windowState: state,
    })

    for (const { action, result: actionResult } of result.results) {
      if (action.type === "close" && actionResult.success) {
        deps.sessions.delete(action.sessionId)
        log("[tmux-session-manager] removed closed session from cache", {
          sessionId: action.sessionId,
        })
      }
      if (action.type === "replace" && actionResult.success) {
        deps.sessions.delete(action.oldSessionId)
        log("[tmux-session-manager] removed replaced session from cache", {
          oldSessionId: action.oldSessionId,
          newSessionId: action.newSessionId,
        })
      }
    }

    if (!result.success || !result.spawnedPaneId) {
      log("[tmux-session-manager] spawn failed", {
        success: result.success,
        results: result.results.map((r) => ({
          type: r.action.type,
          success: r.result.success,
          error: r.result.error,
        })),
      })
      return
    }

    const sessionReady = await deps.waitForSessionReady(sessionId)
    if (!sessionReady) {
      log("[tmux-session-manager] session not ready after timeout, tracking anyway", {
        sessionId,
        paneId: result.spawnedPaneId,
      })
    }

    const now = Date.now()
    deps.sessions.set(sessionId, {
      sessionId,
      paneId: result.spawnedPaneId,
      description: title,
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
    })

    log("[tmux-session-manager] pane spawned and tracked", {
      sessionId,
      paneId: result.spawnedPaneId,
      sessionReady,
    })

    deps.startPolling()
  } finally {
    deps.pendingSessions.delete(sessionId)
  }
}
