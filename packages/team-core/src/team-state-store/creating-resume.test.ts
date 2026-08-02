/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../config"
import type { TeamSpec } from "../types"
import {
  CREATE_CLEANUP_LEASE_TTL_MS,
  claimCreatingTeamFailure,
  finalizeClaimedCreatingTeamFailure,
  markStuckCreatingTeamFailed,
} from "./creating-resume"
import { cleanupMemberWorktrees } from "./runtime-cleanup"
import { createRuntimeState, loadRuntimeState, transitionRuntimeState } from "./store"

describe("stale creating recovery", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true })
    }))
  })

  test("#given recovery read creating #when the creator activates before recovery claims #then the active worktree is not cleaned", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-creating-race-"))
    temporaryDirectories.push(baseDir)
    const worktreePath = path.join(baseDir, "worktrees", "lead")
    await mkdir(worktreePath, { recursive: true })
    const config = TeamModeConfigSchema.parse({ base_dir: baseDir })
    const spec: TeamSpec = {
      version: 1,
      name: "activation-race",
      createdAt: Date.now(),
      leadAgentId: "lead",
      members: [{
        kind: "subagent_type",
        name: "lead",
        subagent_type: "sisyphus",
        backendType: "in-process",
        isActive: true,
        worktreePath,
      }],
    }
    const created = await createRuntimeState(spec, "lead-session", "project", config)
    const recoveryReadCreating = Promise.withResolvers<void>()
    const allowRecoveryToContinue = Promise.withResolvers<void>()
    const recovery = (async () => {
      const staleCreatingState = await loadRuntimeState(created.teamRunId, config)
      recoveryReadCreating.resolve()
      await allowRecoveryToContinue.promise
      return markStuckCreatingTeamFailed(staleCreatingState, config)
    })()
    await recoveryReadCreating.promise

    // when
    await transitionRuntimeState(created.teamRunId, (state) => ({ ...state, status: "active" }), config)
    allowRecoveryToContinue.resolve()

    // then
    const [recoveryOutcome] = await Promise.allSettled([recovery])
    expect(existsSync(worktreePath)).toBe(true)
    expect(recoveryOutcome?.status).toBe("fulfilled")
    expect((await loadRuntimeState(created.teamRunId, config)).status).toBe("active")
  })

  test("#given an interrupted cleanup owner #when its lease expires #then one successor takes over and the prior owner cannot finalize", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-cleanup-takeover-"))
    temporaryDirectories.push(baseDir)
    const worktreePath = path.join(baseDir, "worktrees", "lead")
    await mkdir(worktreePath, { recursive: true })
    const config = TeamModeConfigSchema.parse({ base_dir: baseDir })
    const spec: TeamSpec = {
      version: 1,
      name: "cleanup-takeover",
      createdAt: Date.now(),
      leadAgentId: "lead",
      members: [{
        kind: "subagent_type",
        name: "lead",
        subagent_type: "sisyphus",
        backendType: "in-process",
        isActive: true,
        worktreePath,
      }],
    }
    const created = await createRuntimeState(spec, "lead-session", "project", config)
    const firstOwner = { ownerId: "00000000-0000-4000-8000-000000000001", ownerPid: 101 }
    const successor = { ownerId: "00000000-0000-4000-8000-000000000002", ownerPid: 202 }
    const leaseStartedAt = 10_000
    const aliveProcess = { isProcessAlive: () => true }
    const firstClaim = await claimCreatingTeamFailure(
      created.teamRunId,
      firstOwner,
      config,
      { ...aliveProcess, now: () => leaseStartedAt },
    )
    const retriedClaim = await claimCreatingTeamFailure(
      created.teamRunId,
      firstOwner,
      config,
      { ...aliveProcess, now: () => leaseStartedAt + 100 },
    )
    const spoofedClaim = await claimCreatingTeamFailure(
      created.teamRunId,
      { ...firstOwner, ownerPid: firstOwner.ownerPid + 1 },
      config,
      { ...aliveProcess, now: () => leaseStartedAt + 101 },
    )

    // when
    const deniedClaim = await claimCreatingTeamFailure(
      created.teamRunId,
      successor,
      config,
      { ...aliveProcess, now: () => leaseStartedAt + 100 + CREATE_CLEANUP_LEASE_TTL_MS - 1 },
    )
    const expiredLiveOwnerClaim = await claimCreatingTeamFailure(
      created.teamRunId,
      successor,
      config,
      { ...aliveProcess, now: () => leaseStartedAt + 100 + CREATE_CLEANUP_LEASE_TTL_MS },
    )
    const takeover = await claimCreatingTeamFailure(
      created.teamRunId,
      successor,
      config,
      { isProcessAlive: () => false, now: () => leaseStartedAt + 100 + CREATE_CLEANUP_LEASE_TTL_MS },
    )

    // then
    expect(firstClaim?.createCleanupLease?.ownerId).toBe(firstOwner.ownerId)
    expect(retriedClaim?.createCleanupLease?.claimedAt).toBe(leaseStartedAt + 100)
    expect(spoofedClaim).toBeNull()
    expect(deniedClaim).toBeNull()
    expect(expiredLiveOwnerClaim).toBeNull()
    expect(takeover?.createCleanupLease?.ownerId).toBe(successor.ownerId)
    expect(await finalizeClaimedCreatingTeamFailure(created.teamRunId, firstOwner, config)).toBe(false)
    if (takeover === null) throw new Error("fixture failed to take over cleanup lease")
    await cleanupMemberWorktrees(takeover)
    expect(await finalizeClaimedCreatingTeamFailure(created.teamRunId, successor, config)).toBe(true)
    expect(existsSync(worktreePath)).toBe(false)
    const finalized = await loadRuntimeState(created.teamRunId, config)
    expect(finalized.status).toBe("failed")
    expect(finalized.createCleanupLease).toBeUndefined()
  })
})
