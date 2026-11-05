import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { mkdir, readFile, readdir, rename, rm, writeFile } from "../fs/resilient"
import type { MemoryIdentityPaths } from "../identity/layout"

export const REFLECTION_RUN_ID_PREFIX = "reflection-run-"
/** `reflection-run-7`, `reflection-run-7.json`, and the epoch-prefixed `1755000000000-reflection-run-7`. */
const RUN_ID_NAME = /^(?:\d+-)?reflection-run-(\d+)(?:\.json)?$/
const RESERVATION_STATE_FILES = ["active.lock", "pending.json"] as const
const RUN_ID_MARK_FILE = "run-id.json"

export type RunIdHighWaterPaths = Pick<MemoryIdentityPaths, "reflection" | "reflectionSessions" | "worktrees">

export function reflectionRunNumber(name: string): number {
  const digits = RUN_ID_NAME.exec(name)?.[1]
  if (digits === undefined) return 0
  const parsed = Number.parseInt(digits, 10)
  return Number.isSafeInteger(parsed) ? parsed : 0
}

/**
 * The highest run number any trace on disk still carries (H1): completion records, run dirs, legacy
 * reflection-session dirs, worktrees, and the live reservation files. The allocator mints one past
 * it, so every removal path exempts the trace that carries it.
 */
export async function scanReflectionRunHighWater(paths: RunIdHighWaterPaths): Promise<number> {
  const scanned = await Promise.all([
    highestNamedRun(join(paths.reflection, "completions")),
    highestNamedRun(join(paths.reflection, "runs")),
    highestNamedRun(paths.reflectionSessions),
    highestNamedRun(paths.worktrees),
    ...RESERVATION_STATE_FILES.map((name) => reservedRun(join(paths.reflection, name))),
  ])
  return Math.max(0, ...scanned)
}

async function highestNamedRun(directory: string): Promise<number> {
  const names = await readdir(directory).catch(() => [] as string[])
  return names.reduce((highest, name) => Math.max(highest, reflectionRunNumber(name)), 0)
}

/** Unreadable reservation state contributes nothing: the reservation store reports it itself. */
async function reservedRun(path: string): Promise<number> {
  const runId = await readFile(path, "utf8")
    .then((raw) => (JSON.parse(raw) as { readonly runId?: unknown }).runId)
    .catch(() => undefined)
  return typeof runId === "string" ? reflectionRunNumber(runId) : 0
}

function reflectionRunIdMarkPath(reflectionDir: string): string {
  return join(reflectionDir, RUN_ID_MARK_FILE)
}

/** The durable high-water mark (H1 Guard 2), or undefined when absent or unreadable (scan only). */
export async function readReflectionRunIdMark(reflectionDir: string): Promise<number | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(reflectionRunIdMarkPath(reflectionDir), "utf8"))
    if (!parsed || typeof parsed !== "object") return undefined
    const highWater = (parsed as { readonly highWater?: unknown }).highWater
    return typeof highWater === "number" && Number.isSafeInteger(highWater) && highWater >= 0 ? highWater : undefined
  } catch {
    return undefined
  }
}

/**
 * Raises the durable mark to `highWater` and never lowers it. The caller holds the
 * `reflection-scheduler` lock, the lock the allocator mints under, so read-max-write cannot race.
 */
export async function recordReflectionRunIdMark(reflectionDir: string, highWater: number): Promise<number> {
  const current = await readReflectionRunIdMark(reflectionDir)
  const next = Math.max(current ?? 0, highWater)
  if (current === next) return next
  await mkdir(reflectionDir, { recursive: true, mode: 0o700 })
  const target = reflectionRunIdMarkPath(reflectionDir)
  const temporary = `${target}.tmp-${randomUUID()}`
  try {
    await writeFile(temporary, `${JSON.stringify({ version: 1, highWater: next })}\n`, { encoding: "utf8", mode: 0o600 })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
  return next
}
