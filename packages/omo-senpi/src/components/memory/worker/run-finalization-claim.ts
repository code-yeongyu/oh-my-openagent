import { existsSync } from "node:fs"
import { join } from "node:path"

import {
  LockContentionError,
  createLockRecord,
  runFinalizationLockPath,
  withLock,
  type MemoryIdentity,
  type ReflectionOutcome,
} from "@oh-my-opencode/memory-core"

import { readRunJson, runArtifactIsFresh } from "./run-artifacts"

export interface FinalizationTerminalResult {
  readonly runId: string
  readonly outcome: ReflectionOutcome | "abandoned_unknown"
}

export type ClaimedRunResult<T> =
  | { readonly status: "completed"; readonly value: T }
  | { readonly status: "terminal"; readonly value: FinalizationTerminalResult }
  | { readonly status: "busy" }

export async function withRunFinalizationClaim<T>(
  identity: MemoryIdentity,
  runDir: string,
  runId: string,
  operation: () => Promise<T>,
  ledger?: { readonly startedAt?: string },
): Promise<ClaimedRunResult<T>> {
  const record = await createLockRecord("reflection-finalize", { runId })
  try {
    return await withLock(
      runFinalizationLockPath(identity.paths.locks, runId),
      record,
      async () => {
        const terminal = await readTerminalRun(runDir, runId, ledger)
        return terminal === undefined
          ? { status: "completed", value: await operation() }
          : { status: "terminal", value: terminal }
      },
      { waitTimeoutMs: 5_000 },
    )
  } catch (error) {
    if (!(error instanceof LockContentionError)) throw error
    const terminal = await readTerminalRun(runDir, runId, ledger)
    return terminal === undefined
      ? { status: "busy" }
      : { status: "terminal", value: terminal }
  }
}

async function readTerminalRun(
  runDir: string,
  runId: string,
  ledger?: { readonly startedAt?: string },
): Promise<FinalizationTerminalResult | undefined> {
  const finalPath = join(runDir, "final.json")
  if (existsSync(finalPath)) {
    const value = await readRunJson<Record<string, unknown>>(finalPath)
    // A sentinel naming another run was left by a run that shared this directory under a colliding
    // id. Throwing here strands the reservation, so it is ignored and this run finalizes normally.
    if (value.runId !== runId) return undefined
    if (!isReflectionOutcome(value.outcome)) {
      throw new Error(`Invalid final sentinel for ${runId}`)
    }
    // A sentinel written before this run started describes an earlier run that shared the
    // directory, so it must not decide this run's outcome or advance its journal cursor.
    if (ledger !== undefined && !runArtifactIsFresh(ledger, asIsoString(value.finishedAt))) return undefined
    return { runId, outcome: value.outcome }
  }
  const abandonedPath = join(runDir, "abandoned.json")
  if (!existsSync(abandonedPath)) return undefined
  const value = await readRunJson<Record<string, unknown>>(abandonedPath)
  if (value.runId !== runId) return undefined
  if (value.outcome !== "abandoned_unknown") {
    throw new Error(`Invalid abandoned sentinel for ${runId}`)
  }
  if (ledger !== undefined && !runArtifactIsFresh(ledger, asIsoString(value.abandonedAt))) return undefined
  return { runId, outcome: "abandoned_unknown" }
}

function asIsoString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function isReflectionOutcome(value: unknown): value is ReflectionOutcome {
  return value === "merged"
    || value === "no_changes"
    || value === "parent_dirty"
    || value === "dirty_uncommitted"
    || value === "merge_conflict"
    || value === "admin_tamper"
    || value === "timed_out"
    || value === "failed"
}
