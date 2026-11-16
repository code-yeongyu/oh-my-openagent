import type { Scheduler } from "./scheduler.ts"

const HEALTH_INTERVAL_MS = 5_000
const SILENCE_KILL_MS = 35_000
const BACKOFF_BASE_MS = 1_000
const BACKOFF_CAP_MS = 30_000

/**
 * The spawning profile's watchdog: a health probe every 5 s; 35 s without a healthy answer kills
 * the engine and respawns it (the launcher bumps the generation) after 1 s x 2^n, at most 30 s.
 * A healthy answer resets the silence clock and the backoff.
 */
export function startWatchdog(deps: {
  readonly scheduler: Scheduler
  readonly probe: () => Promise<boolean>
  readonly kill: () => void
  readonly respawn: () => Promise<void>
}): () => void {
  let lastHealthy = deps.scheduler.now()
  let restarts = 0
  let restarting = false
  let probing = false
  let stopped = false
  let cancelBackoff: () => void = () => undefined
  const stopProbes = deps.scheduler.every(HEALTH_INTERVAL_MS, () => {
    if (restarting || probing || stopped) return
    probing = true
    void deps.probe().then((healthy) => {
      probing = false
      if (stopped || restarting) return
      if (healthy) {
        lastHealthy = deps.scheduler.now()
        restarts = 0
        return
      }
      if (deps.scheduler.now() - lastHealthy < SILENCE_KILL_MS) return
      restarting = true
      deps.kill()
      const delay = Math.min(BACKOFF_BASE_MS * 2 ** restarts, BACKOFF_CAP_MS)
      restarts += 1
      cancelBackoff = deps.scheduler.after(delay, () => {
        void deps.respawn().finally(() => {
          lastHealthy = deps.scheduler.now()
          restarting = false
        })
      })
    })
  })
  return () => {
    stopped = true
    stopProbes()
    cancelBackoff()
  }
}
