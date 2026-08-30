import type { RuntimeState } from "../types"
import type { TeamLayoutCleanupResult } from "../team-layout-tmux/layout-types"

const INCOMPLETE_LAYOUT_CLEANUP_REASONS = new Set<TeamLayoutCleanupResult["reason"]>([
  "backend-unavailable",
  "failed",
  "invalid-execution-target",
  "missing-execution-target",
  "partial",
])

export function isIncompleteLayoutCleanupResult(cleanupResult: TeamLayoutCleanupResult): boolean {
  return INCOMPLETE_LAYOUT_CLEANUP_REASONS.has(cleanupResult.reason)
}

export function preserveLayoutCleanupRecovery(
  runtimeState: RuntimeState,
  cleanupResult?: TeamLayoutCleanupResult,
): RuntimeState {
  const removedPaneIds = new Set(cleanupResult?.removedPaneIds ?? [])
  const pendingPaneIds = new Set([
    ...(cleanupResult?.skippedPaneIds ?? []),
    ...(cleanupResult?.attemptedPaneIds ?? []).filter((paneId) => !removedPaneIds.has(paneId)),
  ])

  for (const paneId of runtimeState.tmuxLayout?.paneIds ?? []) {
    if (!removedPaneIds.has(paneId)) pendingPaneIds.add(paneId)
  }
  for (const member of runtimeState.members) {
    if (member.tmuxPaneId !== undefined && !removedPaneIds.has(member.tmuxPaneId)) {
      pendingPaneIds.add(member.tmuxPaneId)
    }
    if (member.tmuxGridPaneId !== undefined && !removedPaneIds.has(member.tmuxGridPaneId)) {
      pendingPaneIds.add(member.tmuxGridPaneId)
    }
  }

  return {
    ...runtimeState,
    layoutCleanupPending: true,
    members: runtimeState.members.map((member) => {
      const { tmuxPaneId, tmuxGridPaneId, ...memberWithoutPaneIds } = member
      return {
        ...memberWithoutPaneIds,
        ...(tmuxPaneId !== undefined && pendingPaneIds.has(tmuxPaneId) ? { tmuxPaneId } : {}),
        ...(tmuxGridPaneId !== undefined && pendingPaneIds.has(tmuxGridPaneId) ? { tmuxGridPaneId } : {}),
      }
    }),
    tmuxLayout: runtimeState.tmuxLayout === undefined
      ? undefined
      : {
        ...runtimeState.tmuxLayout,
        paneIds: (runtimeState.tmuxLayout.paneIds ?? [])
          .filter((paneId) => pendingPaneIds.has(paneId)),
      },
  }
}

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
