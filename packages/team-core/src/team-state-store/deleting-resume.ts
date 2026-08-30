import type { TeamModeConfig } from "../config"
import type { RuntimeState } from "../types"
import { hasPendingLayoutCleanup } from "./pending-layout-cleanup"
import { cleanupMemberWorktrees, removeRuntimeDirectory } from "./runtime-cleanup"
import { transitionRuntimeState } from "./store"

export async function finishDeletingTeam(
  runtimeState: RuntimeState,
  config: TeamModeConfig,
): Promise<boolean> {
  if (hasPendingLayoutCleanup(runtimeState)) return false

  await cleanupMemberWorktrees(runtimeState)
  await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
    ...currentRuntimeState,
    status: "deleted",
  }), config)
  return await removeRuntimeDirectory(runtimeState.teamRunId, config)
}

export async function cleanTerminalTeam(
  runtimeState: RuntimeState,
  config: TeamModeConfig,
): Promise<boolean> {
  return await removeRuntimeDirectory(runtimeState.teamRunId, config)
}
