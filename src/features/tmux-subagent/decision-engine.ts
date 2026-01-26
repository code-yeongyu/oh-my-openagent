import type { WindowState, PaneAction, SpawnDecision, CapacityConfig } from "./types"

export interface SessionMapping {
  sessionId: string
  paneId: string
  createdAt: Date
}

export function calculateCapacity(
  windowWidth: number,
  config: CapacityConfig
): number {
  const availableForAgents = windowWidth - config.mainPaneMinWidth
  if (availableForAgents <= 0) return 0
  return Math.floor(availableForAgents / config.agentPaneWidth)
}

function calculateAvailableWidth(
  windowWidth: number,
  mainPaneMinWidth: number,
  agentPaneCount: number,
  agentPaneWidth: number
): number {
  const usedByAgents = agentPaneCount * agentPaneWidth
  return windowWidth - mainPaneMinWidth - usedByAgents
}

function findOldestSession(mappings: SessionMapping[]): SessionMapping | null {
  if (mappings.length === 0) return null
  return mappings.reduce((oldest, current) =>
    current.createdAt < oldest.createdAt ? current : oldest
  )
}

function getRightmostPane(state: WindowState): string {
  if (state.agentPanes.length > 0) {
    const rightmost = state.agentPanes.reduce((r, p) => (p.left > r.left ? p : r))
    return rightmost.paneId
  }
  return state.mainPane?.paneId ?? ""
}

export function decideSpawnActions(
  state: WindowState,
  sessionId: string,
  description: string,
  config: CapacityConfig,
  sessionMappings: SessionMapping[]
): SpawnDecision {
  if (!state.mainPane) {
    return { canSpawn: false, actions: [], reason: "no main pane found" }
  }

  const availableWidth = calculateAvailableWidth(
    state.windowWidth,
    config.mainPaneMinWidth,
    state.agentPanes.length,
    config.agentPaneWidth
  )

  if (availableWidth >= config.agentPaneWidth) {
    const targetPaneId = getRightmostPane(state)
    return {
      canSpawn: true,
      actions: [
        {
          type: "spawn",
          sessionId,
          description,
          targetPaneId,
        },
      ],
    }
  }

  if (state.agentPanes.length > 0) {
    const oldest = findOldestSession(sessionMappings)
    
    if (oldest) {
      return {
        canSpawn: true,
        actions: [
          { type: "close", paneId: oldest.paneId, sessionId: oldest.sessionId },
          {
            type: "spawn",
            sessionId,
            description,
            targetPaneId: state.mainPane.paneId,
          },
        ],
        reason: "closing oldest session to make room",
      }
    }
    
    const leftmostPane = state.agentPanes.reduce((l, p) => (p.left < l.left ? p : l))
    return {
      canSpawn: true,
      actions: [
        { type: "close", paneId: leftmostPane.paneId, sessionId: "" },
        {
          type: "spawn",
          sessionId,
          description,
          targetPaneId: state.mainPane.paneId,
        },
      ],
      reason: "closing leftmost pane to make room",
    }
  }

  return {
    canSpawn: false,
    actions: [],
    reason: `window too narrow: available=${availableWidth}, needed=${config.agentPaneWidth}`,
  }
}

export function decideCloseAction(
  state: WindowState,
  sessionId: string,
  sessionMappings: SessionMapping[]
): PaneAction | null {
  const mapping = sessionMappings.find((m) => m.sessionId === sessionId)
  if (!mapping) return null

  const paneExists = state.agentPanes.some((p) => p.paneId === mapping.paneId)
  if (!paneExists) return null

  return { type: "close", paneId: mapping.paneId, sessionId }
}
