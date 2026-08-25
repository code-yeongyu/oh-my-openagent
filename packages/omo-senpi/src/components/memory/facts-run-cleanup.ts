// Post-terminal artifact cleanup for a facts run.
//
// THE ORDERING IS THE CONTRACT: `facts-payload.json` is what reconciliation reads to rebuild a
// run's batch, so it may only be deleted AFTER the terminal sentinel (final.json/abandoned.json)
// is durably on disk. A crash before the sentinel therefore leaves every reconciliation input
// intact; a crash after it leaves at most a stale payload, which the session-start sweep below
// removes. Deletion is never allowed to rewrite or fail a published outcome: an unlink error
// warns and stops there, and ENOENT is success.

import { existsSync } from "node:fs"
import { readdir, rm } from "node:fs/promises"
import { join } from "node:path"

import { describe } from "./facts-run-storage"

/** Artifacts a terminal run no longer needs. Everything else (ledger, sentinel, outcome,
 * extraction, child logs) is diagnosis material and stays. */
const DISPOSABLE = ["facts-payload.json", ".sandbox-tmp"] as const

/** Retention pruning renames a run dir to this prefix before deleting it outside the runs lock. */
export const PRUNE_TOMBSTONE_PREFIX = ".prune-"

export type RemoveRunArtifact = (path: string) => Promise<void>

export interface FactsRunCleanupOptions {
  readonly runDir: string
  /** Deletion seam; defaults to a recursive force-remove (ENOENT already tolerated). */
  readonly remove?: RemoveRunArtifact
  readonly warn?: (message: string, fields: Readonly<Record<string, unknown>>) => void
}

export function removeRunArtifact(path: string): Promise<void> {
  return rm(path, { recursive: true, force: true })
}

/**
 * Deletes a terminal run's disposable artifacts. Callers MUST have written the sentinel first.
 */
export async function cleanupTerminalFactsRun(options: FactsRunCleanupOptions): Promise<void> {
  const remove = options.remove ?? removeRunArtifact
  for (const name of DISPOSABLE) {
    const path = join(options.runDir, name)
    try {
      await remove(path)
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue
      options.warn?.("facts run artifact cleanup failed", { path, error: describe(error) })
    }
  }
}

/**
 * Session-start maintenance: retry cleanup for run dirs that are already terminal but still
 * carry disposable artifacts (the crash window between the sentinel and the deletion), and drop
 * `.prune-*` tombstones left behind when retention pruning crashed between the rename and the
 * removal. A tombstone is already unreachable by reservation, so deleting it is always safe.
 * Non-terminal dirs are never touched - their payload is still a reconciliation input.
 */
export async function sweepTerminalFactsRuns(options: {
  readonly factsDir: string
  readonly remove?: RemoveRunArtifact
  readonly warn?: (message: string, fields: Readonly<Record<string, unknown>>) => void
}): Promise<void> {
  const runsDir = join(options.factsDir, "runs")
  const names = await readdir(runsDir).catch(() => [])
  for (const name of names.sort()) {
    const runDir = join(runsDir, name)
    if (name.startsWith(PRUNE_TOMBSTONE_PREFIX)) {
      try {
        await (options.remove ?? removeRunArtifact)(runDir)
      } catch (error) {
        options.warn?.("facts run tombstone cleanup failed", { path: runDir, error: describe(error) })
      }
      continue
    }
    if (!isTerminalRunDir(runDir)) continue
    if (!DISPOSABLE.some((artifact) => existsSync(join(runDir, artifact)))) continue
    await cleanupTerminalFactsRun({
      runDir,
      ...(options.remove === undefined ? {} : { remove: options.remove }),
      ...(options.warn === undefined ? {} : { warn: options.warn }),
    })
  }
}

export function isTerminalRunDir(runDir: string): boolean {
  return existsSync(join(runDir, "final.json")) || existsSync(join(runDir, "abandoned.json"))
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined
}
