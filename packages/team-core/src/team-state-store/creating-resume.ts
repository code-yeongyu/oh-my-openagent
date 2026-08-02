import { randomUUID } from "node:crypto"

import type { TeamModeConfig } from "../config"
import type { RuntimeState } from "../types"
import { cleanupMemberWorktrees } from "./runtime-cleanup"
import { transitionRuntimeState } from "./store"

export const CREATING_TIMEOUT_MS = 30 * 60 * 1000
export const CREATE_CLEANUP_LEASE_TTL_MS = 5 * 60 * 1000

export type CreateCleanupClaimant = {
  readonly ownerId: string
  readonly ownerPid: number
}

type CreateCleanupClaimDeps = {
  readonly now?: () => number
  readonly isProcessAlive?: (pid: number) => boolean
}

export function createCleanupClaimant(): CreateCleanupClaimant {
  return { ownerId: randomUUID(), ownerPid: process.pid }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return false
  }
}

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
  const claimant = createCleanupClaimant()
  const claimedState = await claimCreatingTeamFailure(runtimeState.teamRunId, claimant, config)
  if (claimedState === null) return false
  await cleanupMemberWorktrees(claimedState)
  return finalizeClaimedCreatingTeamFailure(claimedState.teamRunId, claimant.ownerId, config)
}

export async function claimCreatingTeamFailure(
  teamRunId: string,
  claimant: CreateCleanupClaimant,
  config: TeamModeConfig,
  deps: CreateCleanupClaimDeps = {},
): Promise<RuntimeState | null> {
  const now = (deps.now ?? Date.now)()
  const processIsAlive = deps.isProcessAlive ?? isProcessAlive
  const claimedState = await transitionRuntimeState(teamRunId, (currentRuntimeState) => (
    canClaimCreatingFailure(currentRuntimeState, claimant, now, processIsAlive)
      ? {
          ...currentRuntimeState,
          status: "create_cleanup_pending",
          createCleanupLease: { ...claimant, claimedAt: now },
        }
      : currentRuntimeState
  ), config)
  return claimedState.status === "create_cleanup_pending"
    && claimedState.createCleanupLease?.ownerId === claimant.ownerId
    ? claimedState
    : null
}

export async function finalizeClaimedCreatingTeamFailure(
  teamRunId: string,
  ownerId: string,
  config: TeamModeConfig,
): Promise<boolean> {
  let didFinalize = false
  const finalizedState = await transitionRuntimeState(teamRunId, (currentRuntimeState) => {
    if (currentRuntimeState.status !== "create_cleanup_pending"
      || currentRuntimeState.createCleanupLease?.ownerId !== ownerId) {
      return currentRuntimeState
    }
    didFinalize = true
    return { ...currentRuntimeState, status: "failed", createCleanupLease: undefined }
  }, config)
  return didFinalize && finalizedState.status === "failed"
}

function canClaimCreatingFailure(
  runtimeState: RuntimeState,
  claimant: CreateCleanupClaimant,
  now: number,
  processIsAlive: (pid: number) => boolean,
): boolean {
  if (runtimeState.status === "creating") return true
  if (runtimeState.status !== "create_cleanup_pending") return false
  const lease = runtimeState.createCleanupLease
  if (lease === undefined || lease.ownerId === claimant.ownerId) return true
  return now - lease.claimedAt >= CREATE_CLEANUP_LEASE_TTL_MS || !processIsAlive(lease.ownerPid)
}
