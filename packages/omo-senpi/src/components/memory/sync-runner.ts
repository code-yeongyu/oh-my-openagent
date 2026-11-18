// End-to-end encrypted memory sync for bound sessions. Every session bound to one memory
// repository shares one engine (a refcount per repo); the last release closes it. The engine runs
// only when `memory.sync.enabled` is on AND the account session exists: the device is signed in
// and has joined the account's memory (device-session/resolver.ts). Signed out, or signed in but
// not joined, the runner stays idle and opens nothing. Local commits from any writer -
// memory tools, reflection merges, a person's git commit - reach the engine through a watch on the
// repository's HEAD reflog.

import { watch } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import type { MemoryIdentityPaths } from "@oh-my-opencode/memory-core"
import type {
  DeviceSync,
  EngineStatus,
  OpenDeviceSyncOptions,
  SyncSession,
} from "@oh-my-opencode/memory-core/sync-engine"

import type { ComponentLogger } from "../../extension/types"
import { isSyncConfigError, SYNC_CONFIG_INVALID } from "./sync-config-error"
import { isSyncSessionDeferred } from "./sync-session-deferred"
import { raceDeadline } from "./sync-deadline"
import {
  type AbandonedStarts,
  abandonedStartsOf,
  type HeldStart,
  launchStart,
  type StartPassHooks,
} from "./sync-start-launch"

/** The one line a runner logs when this device has no session to sync with (no network, no state). */
export const SYNC_IDLE_NO_DEVICE_SESSION = "sync idle: no device session"

/** The error code a runner logs when a previous engine for the repo did not close within the bound. */
export const SYNC_CLOSE_WAIT_EXCEEDED = "sync-close-wait-exceeded"
const CLOSE_WAIT_MS = 10_000

/** The status of a repo whose sync engine could not be loaded (the packaged sidecar is missing or broken). */
export const SYNC_UNAVAILABLE = "sync-unavailable"

export interface SyncUnavailableStatus {
  readonly kind: typeof SYNC_UNAVAILABLE
  readonly reason: string
}

export { SYNC_CONFIG_INVALID } from "./sync-config-error"

/** The status of a repo whose sync is off because a configuration value the user set is invalid. */
export interface SyncConfigInvalidStatus {
  readonly kind: typeof SYNC_CONFIG_INVALID
  readonly variable: string
  readonly reason: string
}

/** Thrown by a session resolver whose own packaged sidecar would not load; reported like the engine sidecar. */
export class SyncSidecarUnavailableError extends Error {
  constructor(
    readonly sidecar: string,
    cause: unknown,
  ) {
    super(`the ${sidecar} sidecar could not be loaded: ${String(cause)}`, { cause })
    this.name = "SyncSidecarUnavailableError"
  }
}

export type SyncRuntime = Pick<typeof import("#omo-memory-sync-runtime"), "openDeviceSync">

/**
 * A device's account session. `deviceName` maps a sync principal to the name the account's device
 * list gives it; the device sign-in resolver supplies it, and the memory notice shows the name.
 */
export interface DeviceSyncSession extends SyncSession {
  readonly deviceName?: (principal: string) => string | undefined
  /** Registers a callback for the moment this device's sign-in ends (signed out, or revoked). */
  readonly onEnded?: (notify: () => void) => void
  /** Whether memory sync was turned off on this device since the session opened (#14093). */
  readonly turnedOff?: () => Promise<boolean>
}

/** What makes a memory one space on every device (sync-design section 3). */
export interface SyncSpaceInputs {
  readonly profile: string | null
  readonly projectDir: string
}

export interface SyncSessionRequest {
  readonly identity: string
  readonly paths: MemoryIdentityPaths
  readonly space: SyncSpaceInputs
}

/** A session; null when the device is signed out; `idle` when it is signed in but cannot sync yet. */
export type SyncSessionResolution = DeviceSyncSession | { readonly idle: string } | null

export type SyncSessionResolver = (request: SyncSessionRequest) => Promise<SyncSessionResolution>

/** The line a runner logs when the device is signed in but has not joined the account's memory. */
export const SYNC_IDLE_NOT_JOINED = "sync idle: this device has not joined the account's memory"

/** The line a runner logs when memory sync is turned off on this device (#14093). */
export const SYNC_IDLE_TURNED_OFF = "sync idle: memory sync is turned off on this device"

/** A resolver for a client with no device sign-in at all. */
export const noAccountSession: SyncSessionResolver = async () => null

type HeadWatch = (gitDir: string, onChange: () => void, warn: (message: string) => void) => () => void

type FSWatcher = ReturnType<typeof watch>
type WatchFile = (path: string, options: { readonly persistent: boolean }, listener: () => void) => FSWatcher

export function watchHeadLog(
  gitDir: string,
  onChange: () => void,
  warn: (message: string) => void,
  watchFile: WatchFile = watch,
): () => void {
  let watcher: FSWatcher
  try {
    watcher = watchFile(join(gitDir, "logs", "HEAD"), { persistent: false }, onChange)
  } catch (error) {
    warn(
      `memory sync: cannot watch ${join(gitDir, "logs", "HEAD")} for local commits (${String(error)}); local edits sync on the next stream event or restart`,
    )
    return () => undefined
  }
  watcher.on("error", (error) => warn(`memory sync: the HEAD reflog watch stopped (${String(error)})`))
  return () => watcher.close()
}

export interface SyncRunnerOptions {
  readonly logger: Pick<ComponentLogger, "info" | "warn" | "error">
  readonly resolveSession?: SyncSessionResolver
  readonly open?: (options: OpenDeviceSyncOptions) => Promise<DeviceSync | null>
  /** Loads the engine sidecar; the default is the packaged `#omo-memory-sync-runtime` import. */
  readonly loadRuntime?: () => Promise<SyncRuntime>
  readonly watchHead?: HeadWatch
  /** Called with the repo whose sync failure status appeared, changed kind or cleared. */
  readonly onStatusChange?: (repo: string) => void
  /** How long an acquire waits for the repo's previous engine to close; default 10 s. */
  readonly closeWaitMs?: number
  /** Initial retry delay for a deferred session (keychain dialog, memory repo not created); default 15 s, doubling to a five-minute cap. */
  readonly deferredRetryMs?: number
  /** How long one start pass may run before it is replaced by a retry; default 120 s. */
  readonly startPassDeadlineMs?: number
  /** The runner's own timers (retry delay, close wait); the process's timers by default. Tests count these, not every timer. */
  readonly timers?: SyncRunnerTimers
}

export interface SyncRunnerTimers {
  readonly setTimeout: (run: () => void, ms: number) => ReturnType<typeof setTimeout>
  readonly clearTimeout: (handle: ReturnType<typeof setTimeout> | undefined) => void
}

const PROCESS_TIMERS: SyncRunnerTimers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle),
}

interface Running {
  readonly device: DeviceSync
  readonly unwatch: () => void
  readonly turnedOff: (() => Promise<boolean>) | undefined
}

type HeldOutcome = Running | SyncUnavailableStatus | SyncConfigInvalidStatus

/** What relaunching a repo's start needs (#14093 resumeIdle). */
interface RepoStart {
  readonly identity: string
  readonly paths: MemoryIdentityPaths
  readonly space: SyncSpaceInputs
}

type Held = HeldStart<HeldOutcome> & RepoStart

export interface SyncRunner {
  acquire(
    identity: string,
    paths: MemoryIdentityPaths,
    settings: { readonly enabled: boolean },
    space?: SyncSpaceInputs,
  ): Promise<void>
  release(repo: string): Promise<void>
  /**
   * Closes the engine of every repo whose device was turned off (#14093), reports each as a status change, and keeps
   * the repo held but idle, so its sessions release normally; sync starts again on the first bind after it is turned
   * back on.
   */
  idleTurnedOff(): Promise<void>
  /**
   * Starts a fresh engine for every held repo that runs none (turned off, not joined, signed out), after sync was
   * turned on again on this device; a repo that still cannot sync stays idle. Each restarted repo is a status change.
   */
  resumeIdle(): Promise<void>
  status(repo: string): Promise<EngineStatus | SyncUnavailableStatus | SyncConfigInvalidStatus | null>
  /** A sync principal's device name, from the account sessions this runner resolved; undefined when unknown. */
  deviceName(principal: string): string | undefined
}

export function createSyncRunner(options: SyncRunnerOptions): SyncRunner {
  const resolveSession = options.resolveSession ?? noAccountSession
  const timers = options.timers ?? PROCESS_TIMERS
  // The engine (and the Loro wasm under it) loads only once a device has an account session.
  const loadRuntime = options.loadRuntime ?? (() => import("#omo-memory-sync-runtime"))
  const open = options.open ?? (async (o: OpenDeviceSyncOptions) => (await loadRuntime()).openDeviceSync(o))
  const watchHead = options.watchHead ?? watchHeadLog
  const { logger } = options
  const repos = new Map<string, Held>()
  // Device-name lookups of the sessions resolved so far, by identity (principals are per account).
  const nameLookups = new Map<string, (principal: string) => string | undefined>()
  // A repo whose last session released it, until its engine has closed and dropped the device lease.
  const closing = new Map<string, Promise<void>>()
  // Starts replaced at their deadline outlive the chain that launched them, so they are counted per repo.
  const abandoned = new Map<string, AbandonedStarts>()

  // Closes a running engine and keeps its repo held but idle, so the sessions bound to it release normally and
  // the next bind starts fresh.
  const closeIdle = async (repo: string, held: Held, running: Running): Promise<void> => {
    repos.set(repo, { ...held, ready: Promise.resolve(null) })
    running.unwatch()
    await running.device.close()
  }

  // The device's sign-in ended under a running engine: a later sign-in starts fresh on the next bind.
  const endSession = async (identity: string, repo: string): Promise<void> => {
    const held = repos.get(repo)
    if (held === undefined) return
    const running = await held.ready
    if (running === null || !("device" in running) || repos.get(repo) !== held) return
    nameLookups.delete(identity)
    await closeIdle(repo, held, running)
    logger.info(SYNC_IDLE_NO_DEVICE_SESSION, { identity })
  }

  // Memory sync was turned off on this device under a running engine (the desktop's Turn off, or `omo sync
  // disable` in any OmO process here): the engine stops like one whose sign-in ended. Answers whether it stopped
  // one; never rejects.
  const idleIfTurnedOff = async (repo: string): Promise<boolean> => {
    const held = repos.get(repo)
    if (held === undefined) return false
    try {
      const running = await held.ready
      if (running === null || !("device" in running) || running.turnedOff === undefined) return false
      if (!(await running.turnedOff()) || repos.get(repo) !== held) return false
      await closeIdle(repo, held, running)
      logger.info(SYNC_IDLE_TURNED_OFF, { identity: held.identity })
      return true
    } catch (error) {
      logger.warn("memory sync: a running engine could not be stopped after sync was turned off on this device", {
        identity: held.identity,
        error: String(error),
      })
      return false
    }
  }

  const start = async (
    identity: string,
    paths: MemoryIdentityPaths,
    space: SyncSpaceInputs,
    hooks: StartPassHooks,
  ): Promise<Running | SyncUnavailableStatus | SyncConfigInvalidStatus | null> => {
    let resolved: SyncSessionResolution
    hooks.stage("account read")
    try {
      resolved = await resolveSession({ identity, paths, space })
    } catch (error) {
      if (isSyncSessionDeferred(error)) {
        hooks.deferred(error.message, error.wake)
        return null
      }
      if (isSyncConfigError(error)) {
        logger.error(`memory sync is off: ${error.message}`, {
          identity,
          code: SYNC_CONFIG_INVALID,
          variable: error.variable,
        })
        return { kind: SYNC_CONFIG_INVALID, variable: error.variable, reason: error.message }
      }
      if (!(error instanceof SyncSidecarUnavailableError)) throw error
      logger.warn(`memory sync unavailable: the ${error.sidecar} sidecar could not be loaded`, {
        identity,
        code: SYNC_UNAVAILABLE,
        reason: error.message,
      })
      return { kind: SYNC_UNAVAILABLE, reason: error.message }
    }
    if (resolved === null) {
      logger.info(SYNC_IDLE_NO_DEVICE_SESSION, { identity })
      return null
    }
    if ("idle" in resolved) {
      if (resolved.idle === "sync_off") logger.info(SYNC_IDLE_TURNED_OFF, { identity })
      else logger.info(SYNC_IDLE_NOT_JOINED, { identity, reason: resolved.idle })
      return null
    }
    const session = resolved
    if (session.deviceName !== undefined) nameLookups.set(identity, session.deviceName)
    hooks.stage("engine open")
    if (hooks.replaced()) return null
    if (options.open === undefined) {
      // A missing or unloadable sidecar is an install defect, not a sync failure: report it as a
      // typed status and keep the session running without sync.
      const loaded = await loadRuntime().then(
        () => null,
        (error: unknown) => String(error),
      )
      if (loaded !== null) {
        logger.warn("memory sync unavailable: the sync engine sidecar could not be loaded", {
          identity,
          code: SYNC_UNAVAILABLE,
          reason: loaded,
        })
        return { kind: SYNC_UNAVAILABLE, reason: loaded }
      }
    }
    const device = await open({
      repoDir: paths.repo,
      stateDir: join(paths.runtime, "sync-device"),
      locksDir: paths.locks,
      session,
      // A failed cycle comes at warn so it shows where the person and a harness look; routine lines stay at info.
      log: (line, level) => (level === "warn" ? logger.warn(line, { identity }) : logger.info(line, { identity })),
      // After this device is turned off by another OmO process, the first thing its running engine reports is a
      // status change (the service starts refusing it): go idle first, so readers see a device that does not sync
      // instead of a failure.
      ...(session.turnedOff === undefined
        ? options.onStatusChange === undefined
          ? {}
          : { onStatusChange: () => options.onStatusChange?.(paths.repo) }
        : {
            onStatusChange: () =>
              void idleIfTurnedOff(paths.repo)
                .then(() => options.onStatusChange?.(paths.repo))
                .catch((error: unknown) =>
                  logger.warn("memory sync: the status listener failed", { identity, error: String(error) }),
                ),
          }),
    })
    if (device === null) {
      // The lease may be held by this process's own replaced start, which is still finishing: retry, never idle.
      if (hooks.ownStartInFlight()) {
        hooks.deferred("an earlier start of this memory's sync is still finishing.")
        return null
      }
      logger.info("memory sync idle: another OmO process on this device is syncing this memory", { identity })
      return null
    }
    // A pass replaced at its deadline that opens its engine late never starts it: the fresh pass owns the repo.
    if (hooks.replaced()) {
      await device.close()
      return null
    }
    device.engine.start()
    const unwatch = watchHead(
      join(paths.repo, ".git"),
      () => device.notifyLocalCommit(),
      (message) => logger.warn(message, { identity }),
    )
    session.onEnded?.(() => void endSession(identity, paths.repo))
    // A watch is armed some time after it is created (measured: an append right after creation was
    // missed 9 times in 30, every later one delivered). One debounced local-commit cycle covers a
    // commit that landed in that window.
    device.notifyLocalCommit()
    return { device, unwatch, turnedOff: session.turnedOff }
  }

  const launch = (identity: string, paths: MemoryIdentityPaths, space: SyncSpaceInputs, users: number): Held => {
    // Every pass launchStart puts in the registry carries its start, so resumeIdle can relaunch it (#14093).
    const withStart = (held: HeldStart<HeldOutcome>): Held => Object.assign(held, { identity, paths, space })
    return withStart(
      launchStart(
        {
          logger,
          identity,
          start: (hooks) => start(identity, paths, space, hooks),
          running: (outcome) => "device" in outcome,
          discard: async (outcome) => {
            if (!("device" in outcome)) return
            outcome.unwatch()
            await outcome.device.close()
          },
          current: (held) => repos.get(paths.repo) === held,
          replace: (next) => repos.set(paths.repo, withStart(next)),
          abandoned: abandonedStartsOf(abandoned, paths.repo),
          deferredRetryMs: options.deferredRetryMs,
          startPassDeadlineMs: options.startPassDeadlineMs,
          timers,
        },
        users,
      ),
    )
  }

  return {
    async acquire(identity, paths, settings, space) {
      if (!settings.enabled) return
      // A session rebinding the repo right after the previous one released it would otherwise race
      // the old engine's lease and stay idle; wait for that close first.
      const pending = closing.get(paths.repo)
      const waitMs = options.closeWaitMs ?? CLOSE_WAIT_MS
      if (pending !== undefined && (await raceDeadline(pending, waitMs, timers)) === "timeout")
        logger.error(
          `memory sync: the previous engine for this memory did not close within ${waitMs} ms; starting anyway, and this device may stay idle if it still holds its lease`,
          { identity, code: SYNC_CLOSE_WAIT_EXCEEDED },
        )
      const held = repos.get(paths.repo)
      if (held !== undefined) {
        held.users += 1
        return
      }
      const launched = launch(identity, paths, space ?? { profile: null, projectDir: paths.repo }, 1)
      repos.set(paths.repo, launched)
      await launched.ready
    },
    async release(repo) {
      const held = repos.get(repo)
      if (held === undefined) return
      held.users -= 1
      if (held.users > 0) return
      repos.delete(repo)
      const done = (async () => {
        const running = await held.ready
        if (running === null || !("device" in running)) return
        running.unwatch()
        await running.device.close()
      })()
      const settled = done.catch(() => undefined)
      closing.set(repo, settled)
      try {
        await done
      } finally {
        if (closing.get(repo) === settled) closing.delete(repo)
      }
    },
    async idleTurnedOff() {
      await Promise.all(
        [...repos.keys()].map(async (repo) => {
          // A stopped engine is a status change too: the footer and the desktop snapshot drop its last status.
          if (await idleIfTurnedOff(repo)) options.onStatusChange?.(repo)
        }),
      )
    },
    async resumeIdle() {
      await Promise.all(
        [...repos.entries()].map(async ([repo, held]) => {
          if ((await held.ready) !== null || repos.get(repo) !== held) return
          const resumed = launch(held.identity, held.paths, held.space, held.users)
          repos.set(repo, resumed)
          if ((await resumed.ready) !== null) options.onStatusChange?.(repo)
        }),
      )
    },
    deviceName(principal) {
      for (const lookup of nameLookups.values()) {
        const name = lookup(principal)
        if (name !== undefined) return name
      }
      return undefined
    },
    async status(repo) {
      const running = await repos.get(repo)?.ready
      if (running === undefined || running === null) return null
      return "device" in running ? running.device.status() : running
    },
  }
}
