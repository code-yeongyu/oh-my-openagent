import { dirname, join } from "node:path"

import { existsSync, mkdir, readFile, rename, writeFile } from "@oh-my-opencode/memory-core/fs"

import {
  GitMemoryRepo,
  LockContentionError,
  createLockRecord,
  memoryMaintenanceLockPath,
  sweepEmptyTranscriptJournals,
  withLock,
} from "@oh-my-opencode/memory-core"

import type { MemoryIdentityContext } from "./context"

/** Logger surface the scheduler needs. */
export interface MemoryMaintenanceLogger {
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
}

export interface MemoryMaintenanceOptions {
  readonly logger?: MemoryMaintenanceLogger
  readonly createRepo?: (context: MemoryIdentityContext) => GitMemoryRepo
  /** Wait after a session binds, so maintenance never competes with startup or the first prompt. */
  readonly delayMs?: number
  /** At most one run per identity in this interval, across every session and process. */
  readonly intervalMs?: number
  readonly minLooseObjects?: number
  readonly timeoutMs?: number
  readonly now?: () => number
  readonly isLiveSession?: (sessionId: string) => boolean
}

export interface MemoryMaintenance {
  /** Schedules one background pass for this identity; repeated calls in this process are no-ops. */
  schedule(context: MemoryIdentityContext): void
  /**
   * Cancels passes not yet started and stops a running one (session exit). The scheduler stays usable:
   * a shared host keeps serving other sessions, and the next session to bind schedules a fresh pass.
   */
  dispose(): void
  /** Resolves once every scheduled pass has run (or failed, or been disposed). */
  settled(): Promise<void>
}

// Read-only: older builds stamped the repo's shared .git/config, which a reflection or dream run snapshots
// and validates at completion, so a pass overlapping a run failed it (#9962). The stamp now lives in the
// identity's runtime dir; a recent legacy value still holds the interval.
const LEGACY_STAMP_KEY = "omo.maintenanceAt"
const STAMP_FILE = "maintenance-at"
const DEFAULT_DELAY_MS = 30_000
const DEFAULT_INTERVAL_MS = 12 * 60 * 60 * 1000
// git's own gc.auto default is 6,700; packing earlier keeps history walks fast on slower disks.
const DEFAULT_MIN_LOOSE_OBJECTS = 2_000
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Keeps the memory repo packed off the hot path (#9667). Commits set `gc.auto=0` so no commit waits on
 * a repack; this background pass is what packs the loose objects instead.
 *
 * - One runner per identity across every session and process: the pass holds the identity's
 *   `memory-maintenance` lock and a session that finds it held skips (it never waits). This lock, not
 *   git, is what keeps two passes apart.
 * - At most once per interval: the stamp lives in the repo's own config and is read and written while
 *   holding that lock, so many sessions starting together still produce one pass.
 * - Safe with concurrent commits: `GitMemoryRepo.maintain()` only packs and then deletes loose copies of
 *   objects a pack already holds (`prune-packed`); it never prunes unreachable objects, so an object a
 *   writer has just created is never removed.
 * - Off the hot path: it starts after a delay, the timer never keeps a process alive, `dispose()` (session
 *   exit) cancels it and stops a running git, and every failure is logged, never raised.
 * - Empty transcript journals left by older builds (#9737) are swept once per identity per process, at
 *   once rather than behind the delay: control sessions exit within seconds and dispose() would cancel it.
 */
async function readStamp(path: string): Promise<number> {
  try {
    const value = Number((await readFile(path, "utf8")).trim())
    return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Number.NEGATIVE_INFINITY
    throw error
  }
}

// Written under the maintenance lock; the rename keeps a crash from leaving a torn value (a torn or
// missing stamp only means the next pass comes due early).
async function writeStamp(path: string, value: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, String(value))
  await rename(temp, path)
}

export function createMemoryMaintenance(options: MemoryMaintenanceOptions = {}): MemoryMaintenance {
  const createRepo = options.createRepo
    ?? ((context: MemoryIdentityContext) => new GitMemoryRepo({ dir: context.identityPaths.repo, agentId: context.identity }))
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const minLooseObjects = options.minLooseObjects ?? DEFAULT_MIN_LOOSE_OBJECTS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const now = options.now ?? Date.now
  let abort = new AbortController()
  const scheduled = new Set<string>()
  const swept = new Set<string>()
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>()
  const running = new Set<Promise<void>>()

  async function sweepJournals(context: MemoryIdentityContext): Promise<void> {
    const result = await sweepEmptyTranscriptJournals({
      transcriptsDir: context.identityPaths.transcripts,
      now,
      ...(options.isLiveSession === undefined ? {} : { isLive: options.isLiveSession }),
    })
    if (result.removed.length > 0) {
      options.logger?.info("omo-senpi memory removed empty transcript journals", {
        identity: context.identity,
        removed: result.removed.length,
        reason: "no messages, no reflection state, idle 10+ minutes",
        kept: result.kept,
      })
    }
  }

  async function run(context: MemoryIdentityContext, signal: AbortSignal): Promise<void> {
    // A transient identity has no repo until it is promoted.
    if (!existsSync(context.identityPaths.repo)) return
    const record = await createLockRecord("memory-maintenance", { runId: `maintenance-${process.pid}` })
    try {
      await withLock(memoryMaintenanceLockPath(context.identityPaths.locks), record, async () => {
        signal.throwIfAborted()
        const repo = createRepo(context)
        const stampPath = join(context.identityPaths.runtime, STAMP_FILE)
        const legacy = Number(await repo.configGet(LEGACY_STAMP_KEY) ?? Number.NaN)
        const last = Math.max(await readStamp(stampPath), Number.isFinite(legacy) ? legacy : Number.NEGATIVE_INFINITY)
        if (Number.isFinite(last) && now() - last < intervalMs) return
        await writeStamp(stampPath, now())
        const result = await repo.maintain({ minLooseObjects, timeoutMs, signal })
        if (result.status === "packed") {
          options.logger?.info("omo-senpi memory repo packed", {
            identity: context.identity,
            looseObjectsBefore: result.looseObjectsBefore,
            looseObjectsAfter: result.looseObjectsAfter,
          })
        }
      }, { waitTimeoutMs: 0 })
    } catch (error) {
      // Another session or process holds the pass: it is that runner's job, not a failure.
      if (error instanceof LockContentionError) return
      throw error
    }
  }

  return {
    schedule(context): void {
      if (scheduled.has(context.identity)) return
      scheduled.add(context.identity)
      if (!swept.has(context.identity)) {
        swept.add(context.identity)
        const sweep: Promise<void> = sweepJournals(context)
          .catch((error: unknown) => {
            options.logger?.warn("omo-senpi memory empty transcript sweep failed", {
              identity: context.identity,
              error: error instanceof Error ? error.message : String(error),
            })
          })
          .finally(() => running.delete(sweep))
        running.add(sweep)
      }
      let finish = (): void => {}
      const pass = new Promise<void>((resolve) => {
        finish = resolve
      }).finally(() => running.delete(pass))
      running.add(pass)
      const timer = setTimeout(() => {
        timers.delete(timer)
        const signal = abort.signal
        void run(context, signal).catch((error: unknown) => {
          if (signal.aborted) return
          options.logger?.warn("omo-senpi memory repo maintenance failed", {
            identity: context.identity,
            error: error instanceof Error ? error.message : String(error),
          })
        }).finally(finish)
      }, delayMs)
      // A short-lived process (a print run, a test) exits without waiting for it.
      timer.unref?.()
      timers.set(timer, finish)
    },
    dispose(): void {
      abort.abort()
      abort = new AbortController()
      for (const [timer, finish] of timers) {
        clearTimeout(timer)
        finish()
      }
      timers.clear()
      scheduled.clear()
    },
    async settled(): Promise<void> {
      await Promise.all([...running])
    },
  }
}
