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
  readonly probeProcess?: (pid: number) => void
}

export function createCleanupClaimant(): CreateCleanupClaimant {
  return { ownerId: randomUUID(), ownerPid: process.pid }
}

function isProcessAlive(pid: number, probeProcess: (pid: number) => void): boolean {
  try {
    probeProcess(pid)
    return true
  } catch (error) {
    if (!(error instanceof Error)) throw error
    if ("code" in error && error.code === "EPERM") return true
    if ("code" in error && error.code === "ESRCH") return false
    throw error
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
  let finalized = false
  try {
    await cleanupMemberWorktrees(claimedState)
    finalized = await finalizeClaimedCreatingTeamFailure(claimedState.teamRunId, claimant, config)
    return finalized
  } finally {
    if (!finalized) await releaseClaimedCreatingTeamFailure(claimedState.teamRunId, claimant, config)
  }
}

export async function claimCreatingTeamFailure(
  teamRunId: string,
  claimant: CreateCleanupClaimant,
  config: TeamModeConfig,
  deps: CreateCleanupClaimDeps = {},
): Promise<RuntimeState | null> {
  const now = (deps.now ?? Date.now)()
  const probeProcess = deps.probeProcess ?? ((pid: number) => process.kill(pid, 0))
  const processIsAlive = deps.isProcessAlive ?? ((pid: number) => isProcessAlive(pid, probeProcess))
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
    && isLeaseOwner(claimedState, claimant)
    ? claimedState
    : null
}

export async function finalizeClaimedCreatingTeamFailure(
  teamRunId: string,
  claimant: CreateCleanupClaimant,
  config: TeamModeConfig,
): Promise<boolean> {
  let didFinalize = false
  const finalizedState = await transitionRuntimeState(teamRunId, (currentRuntimeState) => {
    if (currentRuntimeState.status !== "create_cleanup_pending"
      || !isLeaseOwner(currentRuntimeState, claimant)) {
      return currentRuntimeState
    }
    didFinalize = true
    return { ...currentRuntimeState, status: "failed", createCleanupLease: undefined }
  }, config)
  return didFinalize && finalizedState.status === "failed"
}

export async function releaseClaimedCreatingTeamFailure(
  teamRunId: string,
  claimant: CreateCleanupClaimant,
  config: TeamModeConfig,
): Promise<void> {
  await transitionRuntimeState(teamRunId, (runtimeState) => (
    runtimeState.status === "create_cleanup_pending" && isLeaseOwner(runtimeState, claimant)
      ? { ...runtimeState, createCleanupLease: undefined }
      : runtimeState
  ), config)
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
  if (lease === undefined || isLeaseOwner(runtimeState, claimant)) return true
  return now - lease.claimedAt >= CREATE_CLEANUP_LEASE_TTL_MS && !processIsAlive(lease.ownerPid)
}

function isLeaseOwner(runtimeState: RuntimeState, claimant: CreateCleanupClaimant): boolean {
  return runtimeState.createCleanupLease?.ownerId === claimant.ownerId
    && runtimeState.createCleanupLease.ownerPid === claimant.ownerPid
}
