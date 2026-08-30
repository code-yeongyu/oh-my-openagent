import type { RuntimeState } from "../types"

export function hasPendingLayoutCleanup(runtimeState: RuntimeState): boolean {
  if (runtimeState.layoutCleanupPending === true) return true
  if (runtimeState.tmuxLayout?.executionTarget !== undefined) return true
  if ((runtimeState.tmuxLayout?.paneIds?.length ?? 0) > 0) return true
  return runtimeState.members.some((member) => (
    member.tmuxPaneId !== undefined || member.tmuxGridPaneId !== undefined
  ))
}

export function clearLayoutCleanupRecovery(runtimeState: RuntimeState): RuntimeState {
  const {
    layoutCleanupPending: _layoutCleanupPending,
    tmuxLayout: _tmuxLayout,
    ...runtimeStateWithoutLayoutCleanup
  } = runtimeState
  return {
    ...runtimeStateWithoutLayoutCleanup,
    members: runtimeState.members.map((member) => {
      const { tmuxPaneId: _tmuxPaneId, tmuxGridPaneId: _tmuxGridPaneId, ...memberWithoutPaneIds } = member
      return memberWithoutPaneIds
    }),
  }
}
