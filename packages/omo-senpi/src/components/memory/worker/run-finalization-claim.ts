import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import {
  LockContentionError,
  createLockRecord,
  runFinalizationLockPath,
  withLock,
  type MemoryIdentity,
  type ReflectionOutcome,
} from "@oh-my-opencode/memory-core"

import { readRunJson } from "./run-artifacts"

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
): Promise<ClaimedRunResult<T>> {
  const record = await createLockRecord("reflection-finalize", { runId })
  try {
    return await withLock(
      runFinalizationLockPath(identity.paths.locks, runId),
      record,
      async () => {
        const terminal = await readTerminalRun(runDir, runId)
        return terminal === undefined
          ? { status: "completed", value: await operation() }
          : { status: "terminal", value: terminal }
      },
      { waitTimeoutMs: 5_000 },
    )
  } catch (error) {
    if (!(error instanceof LockContentionError)) throw error
    const terminal = await readTerminalRun(runDir, runId)
    return terminal === undefined
      ? { status: "busy" }
      : { status: "terminal", value: terminal }
  }
}

async function readTerminalRun(
  runDir: string,
  runId: string,
): Promise<FinalizationTerminalResult | undefined> {
  const finalPath = join(runDir, "final.json")
  if (existsSync(finalPath)) {
    const value = await readRunJson<Record<string, unknown>>(finalPath)
    if (value.runId !== runId || !isReflectionOutcome(value.outcome)) {
      throw new Error(`Invalid final sentinel for ${runId}`)
    }
    return { runId, outcome: value.outcome }
  }
  const abandonedPath = join(runDir, "abandoned.json")
  if (!existsSync(abandonedPath)) return undefined
  const value = await readRunJson<Record<string, unknown>>(abandonedPath)
  if (value.runId !== runId || value.outcome !== "abandoned_unknown") {
    throw new Error(`Invalid abandoned sentinel for ${runId}`)
  }
  return { runId, outcome: "abandoned_unknown" }
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
