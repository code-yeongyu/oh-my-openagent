// Repo maintenance as a host-sweep step (#15419): an identity no session binds never gets the bound pass, so
// without this its transfer packs, reflogs and unreachable objects are never folded or pruned. Each visit
// takes that identity's `memory-maintenance` lock without waiting, so a live runner keeps the repo and the
// visit is skipped.

import { dirname } from "node:path"

import { GitMemoryRepo } from "../git/repo"
import type { GitMaintenanceResult } from "../git/repo-types"
import { buildIdentityPaths } from "../identity/layout"
import { LockContentionError, withLock } from "../locks/acquire"
import { memoryMaintenanceLockPath } from "../locks/domains"
import { createLockRecord } from "../locks/lock-record"
import type { HostSweepIdentity, HostSweepStep } from "./host-sweep"

export interface RepoMaintenanceHostSweepStepOptions {
  /** Identities this process hosts: their own bound pass maintains the repo. */
  readonly isHostedIdentity?: (name: string) => boolean
  readonly minLooseObjects: number
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}

function describeResult(identity: string, result: GitMaintenanceResult): readonly string[] {
  if (result.status === "packed")
    return [`FIXED ${identity} repo packed ${result.looseObjectsBefore} -> ${result.looseObjectsAfter} loose objects`]
  if (result.packsBefore !== result.packsAfter)
    return [`FIXED ${identity} repo packs folded ${result.packsBefore} -> ${result.packsAfter}`]
  return []
}

export function createRepoMaintenanceHostSweepStep(options: RepoMaintenanceHostSweepStepOptions): HostSweepStep {
  return async (identity: HostSweepIdentity) => {
    if (!identity.hasRepo || options.isHostedIdentity?.(identity.name) === true) return []
    const paths = buildIdentityPaths(dirname(dirname(identity.root)), identity.name)
    const record = await createLockRecord("memory-maintenance", { runId: `host-sweep-${process.pid}` })
    try {
      const result = await withLock(
        memoryMaintenanceLockPath(paths.locks),
        record,
        () =>
          new GitMemoryRepo({ dir: paths.repo, agentId: identity.name }).maintain({
            minLooseObjects: options.minLooseObjects,
            timeoutMs: options.timeoutMs,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          }),
        { waitTimeoutMs: 0 },
      )
      return describeResult(identity.name, result)
    } catch (error) {
      if (error instanceof LockContentionError) return []
      if (options.signal?.aborted === true) throw error
      return [`FAIL ${identity.name} repo maintenance failed: ${error instanceof Error ? error.message : String(error)}`]
    }
  }
}
