import type { RuntimeState } from "../types"

export function getTeamLayoutCleanupTarget(
  runtimeState: RuntimeState,
): RuntimeState["tmuxLayout"] | undefined {
  const layout = runtimeState.tmuxLayout
  if (!layout) return undefined

  const paneIds = new Set(layout.paneIds ?? [])
  for (const member of runtimeState.members) {
    if (member.agentType === "leader") continue
    if (member.tmuxPaneId) paneIds.add(member.tmuxPaneId)
    if (member.tmuxGridPaneId) paneIds.add(member.tmuxGridPaneId)
  }

  return paneIds.size > 0
    ? { ...layout, paneIds: Array.from(paneIds) }
    : layout
}
