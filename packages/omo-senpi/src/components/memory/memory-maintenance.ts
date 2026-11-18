import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { dirname } from "node:path"

import {
  readHostSweepState,
  type ForeignMemoryRuntimeSettings,
  RETENTION_STAMP_CONFIG_KEY,
  GitMemoryRepo,
  LockContentionError,
  createLockRecord,
  memoryMaintenanceLockPath,
  retentionCursorPath,
  sweepEmptyTranscriptJournals,
  withLock,
  type RuntimeRetentionPolicy,
} from "@oh-my-opencode/memory-core"
import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"

import { loadMemoryCommandsRuntime } from "./commands/runtime-loader"
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
  /** `memory.runtime` windows for this identity; defaults to the documented ones. */
  readonly resolveRetention?: (context: MemoryIdentityContext) => RuntimeRetentionPolicy
  /** `memory.reflection.enabled` for the identity: the health gate only guards identities that reflect. */
  readonly reflectionEnabled?: (context: MemoryIdentityContext) => boolean
  /** `memory.runtime.max_bytes` for this identity (`0` = unbounded); defaults to the documented 2 GiB. */
  readonly resolveMaxBytes?: (context: MemoryIdentityContext) => number
  /** The memory settings an identity's `memory.runtime` windows and cap resolve from, in the sidecar; the two resolvers above win. */
  readonly memorySettings?: (context: MemoryIdentityContext) => OmoMemorySettings
  /** Encoded sidecar directory names this process's live sessions own. */
  readonly ownedSidecars?: () => ReadonlySet<string>
  /**
   * Driver 2 of the host sweep (design 6b): undefined disables it (CI, task children, print runs);
   * otherwise it returns the GLOBAL memory settings that foreign identities are swept with.
   */
  readonly hostSweep?: () => { readonly settings?: ForeignMemoryRuntimeSettings } | undefined
}

const HOST_SWEEP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

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

const STAMP_KEY = "omo.maintenanceAt"
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
 * - Runtime retention (#10144) runs inside the same gate, after the pack: one pass per identity per
 *   interval removes folded reflection runs, idle journals, sidecars and legacy stores past their
 *   `memory.runtime` windows; the size cap then evicts oldest-first down to `max_bytes` (#10144, design 3).
 *   It is abort-aware between items and logs one summary line. The pass and the host sweep load from the
 *   memory commands sidecar only when one is due, which keeps them out of the entry bundle; a failed load
 *   is logged like any other failure of that step.
 * - Empty transcript journals left by older builds (#9737) are swept once per identity per process, at
 *   once rather than behind the delay: control sessions exit within seconds and dispose() would cancel it.
 */
export function createMemoryMaintenance(options: MemoryMaintenanceOptions = {}): MemoryMaintenance {
  const createRepo =
    options.createRepo ??
    ((context: MemoryIdentityContext) =>
      new GitMemoryRepo({ dir: context.identityPaths.repo, agentId: context.identity }))
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

  /**
   * Due when no completed pass is stamped within the interval, or an interrupted pass left work to resume;
   * a cap resume point whose pass could not even measure waits for the interval (#12538 review r5 L1).
   */
  async function retentionDue(context: MemoryIdentityContext, repo: GitMemoryRepo): Promise<boolean> {
    if (existsSync(retentionCursorPath(context.identityPaths.runtime))) {
      // A failed sidecar load counts as due, so retain() runs and logs that failure as before.
      const resumePending = await loadMemoryCommandsRuntime().then(
        (runtime) => runtime.retentionResumePending(context.identityPaths.runtime),
        () => true,
      )
      if (resumePending) return true
    }
    const last = Number((await repo.configGet(RETENTION_STAMP_CONFIG_KEY)) ?? Number.NaN)
    return !(Number.isFinite(last) && now() - last < intervalMs)
  }

  async function retain(context: MemoryIdentityContext, repo: GitMemoryRepo, signal: AbortSignal): Promise<void> {
    try {
      const { runMaintenanceRetention } = await loadMemoryCommandsRuntime()
      signal.throwIfAborted()
      await runMaintenanceRetention({
        identity: context.identity,
        paths: context.identityPaths,
        repo,
        signal,
        now,
        ...(options.resolveRetention === undefined ? {} : { policy: options.resolveRetention(context) }),
        ...(options.resolveMaxBytes === undefined ? {} : { maxBytes: options.resolveMaxBytes(context) }),
        ...(options.memorySettings === undefined ? {} : { settings: options.memorySettings(context) }),
        reflectionEnabled: options.reflectionEnabled?.(context) ?? true,
        ...(options.isLiveSession === undefined ? {} : { isLiveSession: options.isLiveSession }),
        ...(options.ownedSidecars === undefined ? {} : { ownedSidecars: options.ownedSidecars() }),
        ...(options.logger === undefined
          ? {}
          : { info: options.logger.info.bind(options.logger), warn: options.logger.warn.bind(options.logger) }),
      })
    } catch (error) {
      if (signal.aborted) throw error
      options.logger?.warn("omo-senpi memory runtime retention failed", {
        identity: context.identity,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** One bounded slice of the host-wide sweep, after this identity's own pass, when the round is due. */
  // Every identity a session in this process bound (REVIEW-5 M2). The host sweep skips them: their own
  // pass ran with live sessions, owned sidecars and the project layer, which a foreign visit lacks.
  // Kept after a session exits, which only ever keeps more.
  const hosted = new Set<string>()

  async function sweepHost(context: MemoryIdentityContext, signal: AbortSignal): Promise<void> {
    const host = options.hostSweep?.()
    if (host === undefined) return
    const memoryRoot = dirname(dirname(context.identityPaths.root))
    const state = await readHostSweepState(memoryRoot)
    const completedAt = state.completedAt === undefined ? Number.NaN : Date.parse(state.completedAt)
    if (state.cursor === undefined && Number.isFinite(completedAt) && now() - completedAt < HOST_SWEEP_INTERVAL_MS)
      return
    const { runMaintenanceHostSweep } = await loadMemoryCommandsRuntime()
    signal.throwIfAborted()
    await runMaintenanceHostSweep({
      memoryRoot,
      ...(host.settings === undefined ? {} : { settings: host.settings }),
      isHostedIdentity: (name) => hosted.has(name),
      signal,
      now,
      ...(options.logger === undefined ? {} : { info: options.logger.info.bind(options.logger) }),
    })
  }

  async function run(context: MemoryIdentityContext, signal: AbortSignal): Promise<void> {
    // A transient identity has no repo until it is promoted.
    if (!existsSync(context.identityPaths.repo)) return
    const record = await createLockRecord("memory-maintenance", { runId: `maintenance-${process.pid}` })
    try {
      await withLock(
        memoryMaintenanceLockPath(context.identityPaths.locks),
        record,
        async () => {
          signal.throwIfAborted()
          const repo = createRepo(context)
          const last = Number((await repo.configGet(STAMP_KEY)) ?? Number.NaN)
          if (!(Number.isFinite(last) && now() - last < intervalMs)) {
            await repo.configSet(STAMP_KEY, String(now()))
            const result = await repo.maintain({ minLooseObjects, timeoutMs, signal })
            if (result.status === "packed") {
              options.logger?.info("omo-senpi memory repo packed", {
                identity: context.identity,
                looseObjectsBefore: result.looseObjectsBefore,
                looseObjectsAfter: result.looseObjectsAfter,
              })
            }
          }
          if (await retentionDue(context, repo)) await retain(context, repo, signal)
          await sweepHost(context, signal).catch((error: unknown) => {
            if (signal.aborted) throw error
            options.logger?.warn("omo-senpi memory host sweep failed", {
              error: error instanceof Error ? error.message : String(error),
            })
          })
        },
        { waitTimeoutMs: 0 },
      )
    } catch (error) {
      // Another session or process holds the pass: it is that runner's job, not a failure.
      if (error instanceof LockContentionError) return
      throw error
    }
  }

  return {
    schedule(context): void {
      hosted.add(context.identity)
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
        void run(context, signal)
          .catch((error: unknown) => {
            if (signal.aborted) return
            options.logger?.warn("omo-senpi memory repo maintenance failed", {
              identity: context.identity,
              error: error instanceof Error ? error.message : String(error),
            })
          })
          .finally(finish)
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
