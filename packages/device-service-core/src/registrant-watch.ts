import { existsSync, type FSWatcher, watch } from "node:fs"
import { basename, dirname } from "node:path"

/** Arms a watch that calls `onChange` when the service's endpoint file may have appeared; returns its stop. */
export type EndpointWatch = (endpointPath: string, onChange: () => void) => () => void

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
export const watchEndpointFile: EndpointWatch = (endpointPath, onChange) => {
  const stateDir = dirname(endpointPath)
  const endpointName = basename(endpointPath)
  let watcher: FSWatcher | undefined
  let watched: string | undefined
  let stopped = false

  const arm = (): void => {
    if (stopped) return
    const target = nearestExisting(stateDir)
    if (target === watched) return
    watcher?.close()
    watched = target
    try {
      watcher = watch(target, { persistent: false }, (_event, name) => {
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
    if (nearestExisting(stateDir) !== target) arm()
  }

  arm()
  return () => {
    stopped = true
    watcher?.close()
  }
}
