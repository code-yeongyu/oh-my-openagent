import {
  existsSync,
  mkdir,
  readFile,
  readFileSync,
  readdir,
  rename,
  rm,
  stat,
  statSync,
  writeFile,
} from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_NUDGED_AGE_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000
const PRUNE_TOMBSTONE_PREFIX = ".prune-"
const LAST_PRUNE_MARKER = ".last-prune"
const OUTCOME_FILE = "outcome.json"
const RUNS_DIRNAME = "runs"

export type KibitzerRunStatus = "completed" | "failed" | "dropped"
export type KibitzerRunWarn = (message: string, fields?: Readonly<Record<string, unknown>>) => void
export type RemoveKibitzerRun = (path: string) => Promise<void>

export interface WriteKibitzerRunOutcomeInput {
  readonly runDir: string
  readonly runId: string
  readonly status: KibitzerRunStatus
  readonly model?: string
  readonly cause?: string
  readonly nudged: readonly string[]
  readonly now: () => Date
  readonly warn?: KibitzerRunWarn
}

export interface PruneKibitzerRunsInput {
  readonly recallDir: string
  readonly now: () => Date
  readonly maxAgeMs?: number
  readonly maxNudgedAgeMs?: number
  readonly remove?: RemoveKibitzerRun
  readonly warn?: KibitzerRunWarn
}

export interface CreateThrottledPruneInput {
  readonly recallDir: string
  readonly now: () => Date
  readonly intervalMs?: number
  readonly prune?: (input: PruneKibitzerRunsInput) => Promise<{ readonly removed: number; readonly kept: number }>
  readonly warn?: KibitzerRunWarn
}

export async function writeKibitzerRunOutcome(options: WriteKibitzerRunOutcomeInput): Promise<void> {
  try {
    const payload = {
      version: 1,
      runId: options.runId,
      status: options.status,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.cause === undefined ? {} : { cause: options.cause }),
      nudged: options.nudged,
      finishedAt: options.now().toISOString(),
    }
    await mkdir(options.runDir, { recursive: true, mode: 0o700 })
    await writeFile(join(options.runDir, OUTCOME_FILE), `${JSON.stringify(payload)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    })
  } catch (error) {
    options.warn?.("kibitzer run outcome write failed", { runDir: options.runDir, error: describe(error) })
  }
}

export async function pruneKibitzerRuns(
  options: PruneKibitzerRunsInput,
): Promise<{ removed: number; kept: number }> {
  const runsDir = join(options.recallDir, RUNS_DIRNAME)
  const remove = options.remove ?? ((path: string) => rm(path, { recursive: true, force: true }))
  const names = await readdir(runsDir).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return []
    options.warn?.("kibitzer run prune listing failed", { path: runsDir, error: describe(error) })
    return []
  })
  let removed = 0
  let kept = 0
  const tombstones: string[] = []
  const runs: string[] = []
  for (const name of names) {
    if (name.startsWith(PRUNE_TOMBSTONE_PREFIX)) tombstones.push(name)
    else runs.push(name)
  }
  for (const name of tombstones) {
    if (await removePath(join(runsDir, name), remove, options.warn, "kibitzer run tombstone cleanup failed")) {
      removed += 1
    }
  }
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const maxNudgedAgeMs = options.maxNudgedAgeMs ?? DEFAULT_NUDGED_AGE_MS
  for (const name of runs) {
    const dir = join(runsDir, name)
    const newest = await newestFileMtime(dir)
    if (newest === undefined || options.now().getTime() - newest < retentionMs(await readOutcome(dir), maxAgeMs, maxNudgedAgeMs)) {
      kept += 1
      continue
    }
    if (await claimAndRemove(runsDir, name, remove, options.warn)) removed += 1
    else kept += 1
  }
  return { removed, kept }
}

export function createThrottledPrune(options: CreateThrottledPruneInput): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const prune = options.prune ?? pruneKibitzerRuns
  const marker = join(options.recallDir, LAST_PRUNE_MARKER)
  let inFlight = false
  return () => {
    if (inFlight) return
    if (markerIsFresh(marker, options.now, intervalMs)) return
    inFlight = true
    void (async () => {
      try {
        await mkdir(options.recallDir, { recursive: true })
        await writeFile(marker, `${options.now().toISOString()}\n`, { encoding: "utf8", mode: 0o600 })
        await prune({
          recallDir: options.recallDir,
          now: options.now,
          ...(options.warn === undefined ? {} : { warn: options.warn }),
        })
      } catch (error) {
        options.warn?.("kibitzer run prune failed", { error: describe(error) })
      } finally {
        inFlight = false
      }
    })()
  }
}

async function readOutcome(runDir: string): Promise<unknown> {
  try {
    const raw = await readFile(join(runDir, OUTCOME_FILE), "utf8")
    const parsed: unknown = JSON.parse(typeof raw === "string" ? raw : String(raw))
    return parsed
  } catch {
    return undefined
  }
}

function retentionMs(outcome: unknown, maxAgeMs: number, maxNudgedAgeMs: number): number {
  if (!isRecord(outcome)) return maxAgeMs
  if (outcome.status === "failed" || (outcome.status === "dropped" && outcome.cause === "deadline")) return maxNudgedAgeMs
  return Array.isArray(outcome.nudged) && outcome.nudged.length > 0 ? maxNudgedAgeMs : maxAgeMs
}

async function newestFileMtime(dir: string): Promise<number | undefined> {
  const names = await readdir(dir).catch(() => undefined)
  if (names === undefined) return undefined
  if (names.length === 0) return await mtime(dir)
  let newest: number | undefined
  for (const name of names) {
    const stamp = await mtime(join(dir, name))
    if (stamp === undefined) continue
    if (newest === undefined || stamp > newest) newest = stamp
  }
  return newest
}

async function mtime(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return undefined
  }
}

async function claimAndRemove(
  runsDir: string,
  name: string,
  remove: RemoveKibitzerRun,
  warn: KibitzerRunWarn | undefined,
): Promise<boolean> {
  const from = join(runsDir, name)
  const tombstone = join(runsDir, `${PRUNE_TOMBSTONE_PREFIX}${name}`)
  try {
    await rename(from, tombstone)
  } catch (error) {
    if (errorCode(error) === "ENOENT") return true
    warn?.("kibitzer run prune rename failed", { path: from, error: describe(error) })
    return false
  }
  return removePath(tombstone, remove, warn, "kibitzer run prune remove failed")
}

async function removePath(
  path: string,
  remove: RemoveKibitzerRun,
  warn: KibitzerRunWarn | undefined,
  message: string,
): Promise<boolean> {
  try {
    await remove(path)
    return true
  } catch (error) {
    if (errorCode(error) === "ENOENT") return true
    warn?.(message, { path, error: describe(error) })
    return false
  }
}

function markerIsFresh(marker: string, now: () => Date, intervalMs: number): boolean {
  try {
    if (!existsSync(marker)) return false
    const raw = readFileSync(marker, "utf8")
    const text = typeof raw === "string" ? raw.trim() : ""
    const parsed = Date.parse(text)
    const last = Number.isFinite(parsed) ? parsed : statSync(marker).mtimeMs
    return now().getTime() - last < intervalMs
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function errorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined
  const code = error.code
  return typeof code === "string" ? code : undefined
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
