/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../config"
import type { TeamSpec } from "../types"
import {
  CREATE_CLEANUP_LEASE_TTL_MS,
  claimCreatingTeamFailure,
  finalizeClaimedCreatingTeamFailure,
  markStuckCreatingTeamFailed,
  releaseClaimedCreatingTeamFailure,
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
    const permissionDeniedClaim = await claimCreatingTeamFailure(
      created.teamRunId,
      successor,
      config,
      {
        now: () => leaseStartedAt + 100 + CREATE_CLEANUP_LEASE_TTL_MS,
        probeProcess: () => {
          throw Object.assign(new Error("operation not permitted"), { code: "EPERM" })
        },
      },
    )
    const takeover = await claimCreatingTeamFailure(
      created.teamRunId,
      successor,
      config,
      {
        now: () => leaseStartedAt + 100 + CREATE_CLEANUP_LEASE_TTL_MS,
        probeProcess: () => {
          throw Object.assign(new Error("no such process"), { code: "ESRCH" })
        },
      },
    )

    // then
    expect(firstClaim?.createCleanupLease?.ownerId).toBe(firstOwner.ownerId)
    expect(retriedClaim?.createCleanupLease?.claimedAt).toBe(leaseStartedAt + 100)
    expect(spoofedClaim).toBeNull()
    expect(deniedClaim).toBeNull()
    expect(expiredLiveOwnerClaim).toBeNull()
    expect(permissionDeniedClaim).toBeNull()
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

  test("#given an expired lease whose pid was reused #when the successor claims #then the replacement process does not pin the stale owner", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-cleanup-pid-reuse-"))
    temporaryDirectories.push(baseDir)
    const config = TeamModeConfigSchema.parse({ base_dir: baseDir })
    const spec: TeamSpec = {
      version: 1,
      name: "pid-reuse",
      createdAt: Date.now(),
      leadAgentId: "lead",
      members: [{
        kind: "subagent_type",
        name: "lead",
        subagent_type: "sisyphus",
        backendType: "in-process",
        isActive: true,
      }],
    }
    const created = await createRuntimeState(spec, "lead-session", "project", config)
    const firstOwner = { ownerId: "00000000-0000-4000-8000-000000000011", ownerPid: 303 }
    const successor = { ownerId: "00000000-0000-4000-8000-000000000012", ownerPid: 404 }
    const firstClaim = await claimCreatingTeamFailure(created.teamRunId, firstOwner, config, {
      now: () => 10_000,
      readProcessIdentity: () => Promise.resolve("darwin:100"),
    })

    const takeover = await claimCreatingTeamFailure(created.teamRunId, successor, config, {
      now: () => 10_000 + CREATE_CLEANUP_LEASE_TTL_MS,
      probeProcess: () => undefined,
      readProcessIdentity: () => Promise.resolve("darwin:200"),
    })

    expect(firstClaim?.createCleanupLease?.ownerIdentity).toBe("darwin:100")
    expect(takeover?.createCleanupLease?.ownerId).toBe(successor.ownerId)
  })

  test("#given a malformed persisted process identity #when runtime state loads #then the lease degrades to unknown ownership", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-cleanup-malformed-identity-"))
    temporaryDirectories.push(baseDir)
    const config = TeamModeConfigSchema.parse({ base_dir: baseDir })
    const spec: TeamSpec = {
      version: 1,
      name: "malformed-identity",
      createdAt: Date.now(),
      leadAgentId: "lead",
      members: [{ kind: "subagent_type", name: "lead", subagent_type: "sisyphus", backendType: "in-process", isActive: true }],
    }
    const created = await createRuntimeState(spec, "lead-session", "project", config)
    const claimant = { ownerId: "00000000-0000-4000-8000-000000000031", ownerPid: 606 }
    const claimed = await claimCreatingTeamFailure(created.teamRunId, claimant, config, {
      readProcessIdentity: () => Promise.resolve("darwin:100"),
    })
    if (claimed?.createCleanupLease === undefined) throw new Error("fixture failed to persist cleanup lease")
    const claimedAt = claimed.createCleanupLease.claimedAt
    const malformed = {
      ...claimed,
      createCleanupLease: { ...claimed.createCleanupLease, ownerIdentity: "not-a-process-identity" },
    }
    await writeFile(path.join(baseDir, "runtime", created.teamRunId, "state.json"), JSON.stringify(malformed))

    const reloaded = await loadRuntimeState(created.teamRunId, config)

    expect(reloaded.status).toBe("create_cleanup_pending")
    expect(reloaded.createCleanupLease?.ownerIdentity).toBeUndefined()
    const takeover = await claimCreatingTeamFailure(created.teamRunId, {
      ownerId: "00000000-0000-4000-8000-000000000032",
      ownerPid: 707,
    }, config, {
      now: () => claimedAt + CREATE_CLEANUP_LEASE_TTL_MS,
      probeProcess: () => undefined,
      readProcessIdentity: () => Promise.resolve("darwin:100"),
    })
    expect(takeover).toBeNull()

    await writeFile(path.join(baseDir, "runtime", created.teamRunId, "state.json"), JSON.stringify({
      ...claimed,
      createCleanupLease: {
        ...claimed.createCleanupLease,
        ownerIdentity: "linux:ABCDEF12-1234-1234-1234-123456789ABC:100",
      },
    }))
    const uppercaseReloaded = await loadRuntimeState(created.teamRunId, config)
    expect(uppercaseReloaded.createCleanupLease?.ownerIdentity).toBeUndefined()
    const uppercaseTakeover = await claimCreatingTeamFailure(created.teamRunId, {
      ownerId: "00000000-0000-4000-8000-000000000033",
      ownerPid: 808,
    }, config, {
      now: () => claimedAt + CREATE_CLEANUP_LEASE_TTL_MS,
      probeProcess: () => undefined,
      readProcessIdentity: () => Promise.resolve("linux:abcdef12-1234-1234-1234-123456789abc:100"),
    })
    expect(uppercaseTakeover).toBeNull()
  })

  test("#given a finalized runtime directory was already removed #when its former owner releases #then release is idempotent", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-cleanup-missing-runtime-"))
    temporaryDirectories.push(baseDir)
    const config = TeamModeConfigSchema.parse({ base_dir: baseDir })
    const spec: TeamSpec = {
      version: 1,
      name: "missing-runtime",
      createdAt: Date.now(),
      leadAgentId: "lead",
      members: [{ kind: "subagent_type", name: "lead", subagent_type: "sisyphus", backendType: "in-process", isActive: true }],
    }
    const created = await createRuntimeState(spec, "lead-session", "project", config)
    const claimant = { ownerId: "00000000-0000-4000-8000-000000000021", ownerPid: 505 }
    await claimCreatingTeamFailure(created.teamRunId, claimant, config)
    expect(await finalizeClaimedCreatingTeamFailure(created.teamRunId, claimant, config)).toBeTrue()
    await rm(path.join(baseDir, "runtime", created.teamRunId), { recursive: true, force: true })

    await expect(releaseClaimedCreatingTeamFailure(created.teamRunId, claimant, config)).resolves.toBeUndefined()
  })

  test("#given cleanup and release both fail #when stale recovery unwinds #then the cleanup error remains primary", async () => {
    const primaryError = new Error("cleanup failed")
    const releaseError = new Error("release failed")
    let releaseAttempted = false
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-cleanup-dual-failure-"))
    temporaryDirectories.push(baseDir)
    const config = TeamModeConfigSchema.parse({ base_dir: baseDir })
    const spec: TeamSpec = {
      version: 1,
      name: "dual-failure",
      createdAt: Date.now(),
      leadAgentId: "lead",
      members: [{ kind: "subagent_type", name: "lead", subagent_type: "sisyphus", backendType: "in-process", isActive: true }],
    }
    const created = await createRuntimeState(spec, "lead-session", "project", config)

    const attempt = markStuckCreatingTeamFailed(created, config, {
      cleanupMemberWorktrees: () => Promise.reject(primaryError),
      releaseClaim: () => {
        releaseAttempted = true
        return Promise.reject(releaseError)
      },
    })

    await expect(attempt).rejects.toBe(primaryError)
    expect(releaseAttempted).toBe(true)
  })
})
