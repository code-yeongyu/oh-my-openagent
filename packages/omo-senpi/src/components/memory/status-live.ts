import { MEMORY_STATUS_KEY } from "./status"
import { sequencedStatus } from "./wiring-context"

const FRAME_INTERVAL_MS = 320

/** Braille spinner frames, matching the ulw-loop footer's animation vocabulary. */
export const MEMORY_REFLECTING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

type TimerHandle = ReturnType<typeof setInterval> | number

export interface MemoryFooterTimers {
  set(callback: () => void, intervalMs: number): TimerHandle
  clear(handle: TimerHandle): void
}

export interface MemoryFooterUi {
  setStatus(key: string, text: string | undefined): void
}

export interface MemoryFooterLiveOptions {
  readonly timers?: MemoryFooterTimers
  /**
   * Cheap change probe (headSha + dirty + backlog + streak + active). A refresh recomputes the
   * segment line only when this value moves, so agent_settled does not run git on every event.
   */
  readonly fingerprint?: (identity: string) => Promise<string | undefined>
  /** Recomputes the full todo-18 segment line; undefined means "nothing to publish". */
  readonly refreshSegments?: (identity: string) => Promise<string | undefined>
}

export interface MemoryFooterLive {
  /** Marks a reflection run active/inactive for the identity; drives the spinner lifecycle. */
  setActive(identity: string | undefined, active: boolean, ui: MemoryFooterUi | undefined): void
  /** Republishes the segment line when the fingerprint changed and no run is animating. */
  refresh(identity: string | undefined, ui: MemoryFooterUi | undefined): Promise<void>
  /** Resolves once a restore triggered by setActive(false) has settled. */
  settled(): Promise<void>
  /**
   * Stops the animation and drops cached state without retiring the instance, so a session that
   * clears its footer can animate again. Used by clearStatus, which fires on every session start.
   */
  stop(): void
  /** Stops the interval permanently; every later call becomes a no-op. */
  dispose(): void
}

/**
 * Owns the memory footer's live behavior: a reflecting spinner while a run is in flight and a
 * fingerprint-deduped segment refresh otherwise. Timers are injectable so tests never sleep.
 */
export function createMemoryFooterLive(options: MemoryFooterLiveOptions = {}): MemoryFooterLive {
  const timers = options.timers ?? defaultTimers
  let timer: TimerHandle | undefined
  let frameIndex = 0
  let activeIdentity: string | undefined
  let activeUi: MemoryFooterUi | undefined
  let disposed = false
  let lastFingerprint: string | undefined
  /** Bumped by every recompute; only the newest one may record a fingerprint (#14837). */
  let generation = 0
  let pending: Promise<void> = Promise.resolve()

  function publishFrame(): void {
    const frame = MEMORY_REFLECTING_FRAMES[frameIndex]
    if (disposed || activeIdentity === undefined || activeUi === undefined || frame === undefined) return
    activeUi.setStatus(MEMORY_STATUS_KEY, `mem:${activeIdentity} ${frame} reflecting`)
  }

  function stopTimer(): void {
    if (timer === undefined) return
    timers.clear(timer)
    timer = undefined
  }

  function tick(): void {
    if (disposed || activeIdentity === undefined) {
      stopTimer()
      return
    }
    frameIndex = (frameIndex + 1) % MEMORY_REFLECTING_FRAMES.length
    publishFrame()
  }

  async function recompute(identity: string, ui: MemoryFooterUi): Promise<void> {
    // Taken before the first read, so this recompute cannot replace a line a later refresh already published.
    const status = sequencedStatus(ui)
    generation += 1
    const mine = generation
    try {
      const fingerprint = await options.fingerprint?.(identity)
      // A newer recompute started while this one was reading: its result, fingerprint included, is stale. Recording
      // the fingerprint here would make the newer recompute skip as unchanged although this line is never shown.
      if (mine !== generation) return
      // An absent probe means "always recompute"; a stable probe short-circuits the git work.
      if (fingerprint !== undefined && fingerprint === lastFingerprint) return
      const text = await options.refreshSegments?.(identity)
      if (mine !== generation) return
      lastFingerprint = fingerprint
      // The run may have started animating while the recompute was in flight; the spinner wins.
      if (disposed || text === undefined || activeIdentity !== undefined) return
      status.setStatus(MEMORY_STATUS_KEY, text)
    } catch {
      // A footer refresh is decoration: a failed probe must never surface as a session error.
    }
  }

  return {
    setActive(identity, active, ui) {
      if (disposed) return
      if (active) {
        if (identity === undefined || ui === undefined) return
        activeIdentity = identity
        activeUi = ui
        if (timer !== undefined) return
        frameIndex = 0
        publishFrame()
        timer = timers.set(tick, FRAME_INTERVAL_MS)
        return
      }
      const restoreIdentity = activeIdentity ?? identity
      const restoreUi = activeUi ?? ui
      activeIdentity = undefined
      activeUi = undefined
      stopTimer()
      frameIndex = 0
      if (restoreIdentity === undefined || restoreUi === undefined) return
      // The spinner overwrote the segment line, so the restore must bypass the dedupe cache.
      lastFingerprint = undefined
      pending = recompute(restoreIdentity, restoreUi)
    },

    async refresh(identity, ui) {
      if (disposed || identity === undefined || ui === undefined) return
      if (activeIdentity !== undefined) return
      await recompute(identity, ui)
    },

    async settled() {
      await pending
    },

    stop() {
      activeIdentity = undefined
      activeUi = undefined
      stopTimer()
      frameIndex = 0
      lastFingerprint = undefined
    },

    dispose() {
      disposed = true
      activeIdentity = undefined
      activeUi = undefined
      stopTimer()
      frameIndex = 0
      lastFingerprint = undefined
    },
  }
}

const defaultTimers: MemoryFooterTimers = {
  set(callback, intervalMs) {
    const handle = setInterval(callback, intervalMs)
    handle.unref()
    return handle
  },
  clear(handle) {
    clearInterval(handle)
  },
}
