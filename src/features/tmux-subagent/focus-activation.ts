import type { TrackedSession, WindowState } from "./types"

export function getSessionsToActivate(
  state: WindowState,
  sessions: Map<string, TrackedSession>,
): TrackedSession[] {
  if (sessions.size === 0) return []

  const sessionsByPaneId = new Map(
    Array.from(sessions.values()).map((tracked) => [tracked.paneId, tracked]),
  )

  return state.agentPanes
    .filter((pane) => pane.isActive)
    .map((pane) => sessionsByPaneId.get(pane.paneId))
    .filter((tracked): tracked is TrackedSession => Boolean(tracked && !tracked.attachActivated))
}
