import { existsSync, type FSWatcher, watch } from "node:fs"
import { basename, dirname } from "node:path"

/** Runs `run` after `ms` and returns its cancel. */
export type WatchSchedule = (run: () => void, ms: number) => () => void

export type EndpointWatchOptions = {
  readonly schedule?: WatchSchedule
  /** Test seam: the directory watch primitive (defaults to node:fs `watch`). */
  readonly watch?: (target: string, listener: (event: string, name: string | null) => void) => FSWatcher
}

/** Arms a watch that calls `onChange` when the service's endpoint file may have appeared; returns its stop. */
export type EndpointWatch = (endpointPath: string, onChange: () => void, options?: EndpointWatchOptions) => () => void

// A directory watch armed a moment before an entry is created can miss that entry: on macOS, 2-5 of 20 creations
// 0-1 ms after arming produced no event, and none from 5 ms on (#12481). Every arm therefore gets ONE settle
// re-check after this delay: it re-walks the path (re-arming if a directory appeared unseen) and re-checks the
// endpoint. A settle only follows an arm, and an arm only follows a change, so nothing polls.
export const ARM_SETTLE_MS = 1_000

const defaultSchedule: WatchSchedule = (run, ms) => {
  const timer = setTimeout(run, ms)
  timer.unref()
  return () => clearTimeout(timer)
}

const nearestExisting = (path: string): string => {
  let current = path
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) return current
    current = parent
  }
  return current
}

/**
 * Watches the endpoint file's directory, or its nearest existing ancestor while that directory does not exist yet
 * (the service is installed after the engine started), re-arming down the path as directories appear and back up
 * when one is removed. Every event re-checks the endpoint file, so a coalesced or missed name never loses a start.
 * The watchers never keep the process alive.
 */
export const watchEndpointFile: EndpointWatch = (endpointPath, onChange, options = {}) => {
  const stateDir = dirname(endpointPath)
  const endpointName = basename(endpointPath)
  const schedule = options.schedule ?? defaultSchedule
  const watchDir = options.watch ?? ((target, listener) => watch(target, { persistent: false }, listener))
  let watcher: FSWatcher | undefined
  let watched: string | undefined
  let stopped = false
  let cancelSettle: (() => void) | undefined
  let endpointAtArm = false

  // Reports only an endpoint that appeared after the last arm: one that already existed was seen by the caller's
  // own check right after arming, so the settle never restarts a connect walk that is already under way.
  const settle = (): void => {
    cancelSettle = undefined
    if (stopped) return
    const existedAtArm = endpointAtArm
    arm()
    if (!existedAtArm && existsSync(endpointPath)) onChange()
  }

  const arm = (): void => {
    if (stopped) return
    const target = nearestExisting(stateDir)
    if (target === watched) return
    watcher?.close()
    watched = target
    try {
      watcher = watchDir(target, (_event, name) => {
        if (target !== stateDir || !existsSync(stateDir)) {
          arm()
          if (existsSync(endpointPath)) onChange()
          return
        }
        if (name === null || name === endpointName) onChange()
      })
      watcher.on("error", () => {
        watched = undefined
        arm()
      })
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error)) throw error
      watched = undefined
      return
    }
    // A directory created between the existence walk and the arm is caught here, after the watch is in place.
    if (nearestExisting(stateDir) !== target) {
      arm()
      return
    }
    endpointAtArm = existsSync(endpointPath)
    cancelSettle?.()
    cancelSettle = schedule(settle, ARM_SETTLE_MS)
  }

  arm()
  return () => {
    stopped = true
    cancelSettle?.()
    watcher?.close()
  }
}
