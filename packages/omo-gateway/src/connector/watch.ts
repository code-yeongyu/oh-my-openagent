// "Did the config or the credential file change?" for a connector stopped on AdapterFatal. The
// parent directories are watched (editors and `mv` replace files, which a file watch can miss) and
// every event is confirmed against a fingerprint (inode, size, mtime, mode) taken when the wait
// began, so a stray event or an unrelated file in the same directory never counts as a change.
// File events can be coalesced or dropped (a chmod on macOS often is), so the fingerprints are also
// re-read every `pollMs`: an event makes the restart prompt, the poll makes it certain.

import { statSync, watch, type FSWatcher } from "node:fs"
import { dirname } from "node:path"

function fingerprint(path: string): string {
  const info = statSync(path, { throwIfNoEntry: false })
  return info === undefined ? "absent" : `${info.ino}:${info.size}:${info.mtimeMs}:${info.mode}`
}

/** A `waitForChange` for the connector host: true once any of `paths` changed, false when `signal` aborts first. */
export const WATCH_POLL_MS = 5_000

export function watchForChange(paths: readonly string[], pollMs: number = WATCH_POLL_MS): (signal: AbortSignal) => Promise<boolean> {
  return (signal) => {
    if (signal.aborted) return Promise.resolve(false)
    const baseline = paths.map(fingerprint)
    const { promise, resolve } = Promise.withResolvers<boolean>()
    const watchers: FSWatcher[] = []
    let settled = false
    let poll: ReturnType<typeof setInterval> | undefined
    const finish = (changed: boolean) => {
      if (settled) return
      settled = true
      clearInterval(poll)
      for (const watcher of watchers) watcher.close()
      signal.removeEventListener("abort", onAbort)
      resolve(changed)
    }
    const onAbort = () => finish(false)
    signal.addEventListener("abort", onAbort, { once: true })
    const check = () => {
      if (paths.some((path, index) => fingerprint(path) !== baseline[index])) finish(true)
    }
    try {
      for (const dir of new Set(paths.map((path) => dirname(path)))) watchers.push(watch(dir, check))
    } catch (error) {
      settled = true
      for (const watcher of watchers) watcher.close()
      signal.removeEventListener("abort", onAbort)
      return Promise.reject(error)
    }
    poll = setInterval(check, pollMs)
    check()
    return promise
  }
}
