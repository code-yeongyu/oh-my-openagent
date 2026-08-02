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
): Promise<void> {
  await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
    ...currentRuntimeState,
    status: "failed",
  }), config)
  await cleanupMemberWorktrees(runtimeState)
}
