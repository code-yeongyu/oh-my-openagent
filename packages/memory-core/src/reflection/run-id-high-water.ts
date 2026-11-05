// The reflection run-id high water (#7095, H1 of #10144/#11976). The allocator mints one past the
// highest `reflection-run-N` it can still see; anything that removes or moves the highest trace aside
// would otherwise let that id be minted again and collide with its durable completion record. The
// six on-disk sources are scanned here so the allocator and every remover read the same answer, and
// `run-id.json` keeps a mark that survives the removal of the trace it came from.

import { join } from "node:path"

import { readFile, readdir } from "../fs/resilient"
import { readJsonOptional, writeJsonAtomic } from "./reservation-files"

export const RUN_ID_HIGH_WATER_FILENAME = "run-id.json"

/** `reflection-run-7`, `reflection-run-7.json`, and the epoch-prefixed `1755000000000-reflection-run-7`. */
const RUN_ID_NAME = /^(?:\d+-)?reflection-run-(\d+)(?:\.json)?$/
const RESERVATION_STATE_FILES = ["active.lock", "pending.json"] as const

export interface RunIdHighWaterPaths {
  readonly reflection: string
  readonly reflectionSessions: string
  readonly worktrees: string
}

export function reflectionRunNumber(name: string): number {
  const digits = RUN_ID_NAME.exec(name)?.[1]
  if (digits === undefined) return 0
  const parsed = Number.parseInt(digits, 10)
  return Number.isSafeInteger(parsed) ? parsed : 0
}

async function highestNamedRun(directory: string): Promise<number> {
  const names = await readdir(directory).catch(() => [] as string[])
  return names.reduce((highest, name) => Math.max(highest, reflectionRunNumber(name)), 0)
}

/**
 * Live reservations hold an id before any completion record or run directory exists for it. An
 * unreadable reservation contributes nothing here; the reservation store reports it itself.
 */
async function highestReservedRun(reflectionDir: string): Promise<number> {
  const reserved = await Promise.all(
    RESERVATION_STATE_FILES.map(async (name) => {
      const runId = await readFile(join(reflectionDir, name), "utf8")
        .then((raw) => (JSON.parse(raw) as { readonly runId?: unknown }).runId)
        .catch(() => undefined)
      return typeof runId === "string" ? reflectionRunNumber(runId) : 0
    }),
  )
  return Math.max(0, ...reserved)
}

export async function scanRunIdHighWater(paths: RunIdHighWaterPaths): Promise<number> {
  const scanned = await Promise.all([
    highestNamedRun(join(paths.reflection, "completions")),
    highestNamedRun(join(paths.reflection, "runs")),
    highestNamedRun(paths.reflectionSessions),
    highestNamedRun(paths.worktrees),
    highestReservedRun(paths.reflection),
  ])
  return Math.max(0, ...scanned)
}

/** The recorded mark; 0 when `run-id.json` is missing or unreadable, which falls back to the scan. */
export async function readRecordedRunIdHighWater(reflectionDir: string): Promise<number> {
  try {
    const value = await readJsonOptional(join(reflectionDir, RUN_ID_HIGH_WATER_FILENAME))
    const highWater = typeof value === "object" && value !== null ? (value as { highWater?: unknown }).highWater : undefined
    return typeof highWater === "number" && Number.isSafeInteger(highWater) && highWater > 0 ? highWater : 0
  } catch {
    return 0
  }
}

/** Raises the recorded mark to `highWater`; it never lowers it. Callers hold the scheduler lock. */
export async function recordRunIdHighWater(reflectionDir: string, highWater: number): Promise<number> {
  const recorded = await readRecordedRunIdHighWater(reflectionDir)
  const next = Math.max(recorded, highWater)
  if (next > recorded) await writeJsonAtomic(join(reflectionDir, RUN_ID_HIGH_WATER_FILENAME), { version: 1, highWater: next })
  return next
}
