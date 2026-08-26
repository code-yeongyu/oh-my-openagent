import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import type { MemoryIdentityPaths } from "@oh-my-opencode/memory-core"

const RUN_ID_PREFIX = "reflection-run-"
/** `reflection-run-7`, `reflection-run-7.json`, and the epoch-prefixed `1755000000000-reflection-run-7`. */
const RUN_ID_NAME = /^(?:\d+-)?reflection-run-(\d+)(?:\.json)?$/
const RESERVATION_STATE_FILES = ["active.lock", "pending.json"] as const

/**
 * Mints reflection run ids one past the highest id still ON DISK, the same way the facts lane
 * derives its attempt sequence.
 *
 * A bare per-process counter restarts at 1 on every launch, so a later generation re-mints a
 * retired id and collides with that run's durable completion record
 * ("Reflection completion record mismatch for reflection-run-1"), wedging launch, reconcile, and
 * finalization permanently (issue #7095). Scanning persisted state instead means a name is handed
 * back only once no trace of it survives, which is also what makes manual cleanup effective.
 */
export function createReflectionRunIdFactory(input: {
  readonly identityPaths: MemoryIdentityPaths
}): () => Promise<string> {
  const directories = [
    join(input.identityPaths.reflection, "completions"),
    join(input.identityPaths.reflection, "runs"),
    input.identityPaths.reflectionSessions,
    input.identityPaths.worktrees,
  ]
  let highWater = 0
  return async () => {
    const scanned = await Promise.all([
      ...directories.map(highestNamedRun),
      highestReservedRun(input.identityPaths.reflection),
    ])
    highWater = Math.max(highWater, ...scanned) + 1
    return `${RUN_ID_PREFIX}${highWater}`
  }
}

async function highestNamedRun(directory: string): Promise<number> {
  const names = await readdir(directory).catch(() => [] as string[])
  return names.reduce((highest, name) => Math.max(highest, runNumber(name)), 0)
}

/**
 * Live reservations hold an id before any completion record or run directory exists for it.
 * Unreadable state contributes nothing: the reservation store is the authority on validity and
 * reports malformed records itself, immediately after this mint, under the same lock.
 */
async function highestReservedRun(reflectionDir: string): Promise<number> {
  const reserved = await Promise.all(
    RESERVATION_STATE_FILES.map(async (name) => {
      const runId = await readFile(join(reflectionDir, name), "utf8")
        .then((raw) => (JSON.parse(raw) as { readonly runId?: unknown }).runId)
        .catch(() => undefined)
      return typeof runId === "string" ? runNumber(runId) : 0
    }),
  )
  return Math.max(0, ...reserved)
}

function runNumber(name: string): number {
  const digits = RUN_ID_NAME.exec(name)?.[1]
  if (digits === undefined) return 0
  const parsed = Number.parseInt(digits, 10)
  return Number.isSafeInteger(parsed) ? parsed : 0
}
