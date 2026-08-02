import type { TeamModeConfig } from "../config"
import type { RuntimeState } from "../types"
import { cleanupMemberWorktrees } from "./runtime-cleanup"
import { transitionRuntimeState } from "./store"

export const CREATING_TIMEOUT_MS = 30 * 60 * 1000

export function isCreatingStateStuck(
  runtimeState: RuntimeState,
  now: number,
  creatingTimeoutMs: number,
): boolean {
  return runtimeState.status === "creating" && now - runtimeState.createdAt > creatingTimeoutMs
}

export async function markStuckCreatingTeamFailed(
  runtimeState: RuntimeState,
  config: TeamModeConfig,
): Promise<boolean> {
  const claimedState = await claimCreatingTeamFailure(runtimeState.teamRunId, config)
  if (claimedState === null) return false
  await cleanupMemberWorktrees(claimedState)
  await finalizeClaimedCreatingTeamFailure(claimedState.teamRunId, config)
  return true
}

export async function claimCreatingTeamFailure(
  teamRunId: string,
  config: TeamModeConfig,
): Promise<RuntimeState | null> {
  const claimedState = await transitionRuntimeState(teamRunId, (currentRuntimeState) => (
    currentRuntimeState.status === "creating"
      ? { ...currentRuntimeState, status: "create_cleanup_pending" }
      : currentRuntimeState
  ), config)
  return claimedState.status === "create_cleanup_pending" ? claimedState : null
}

export async function finalizeClaimedCreatingTeamFailure(
  teamRunId: string,
  config: TeamModeConfig,
): Promise<void> {
  await transitionRuntimeState(teamRunId, (currentRuntimeState) => (
    currentRuntimeState.status === "create_cleanup_pending"
      ? { ...currentRuntimeState, status: "failed" }
      : currentRuntimeState
  ), config)
}
