import { existsSync, watch, type FSWatcher } from "node:fs"
import { dirname } from "node:path"

export type SentinelWaitResult = "present" | "timeout"

const RUN_STATE_RECHECK_INTERVAL_MS = 25

async function waitForRunState(
  directory: string,
  isReady: () => boolean,
  deadlineAt: number,
  now: () => number,
  signal?: AbortSignal,
): Promise<SentinelWaitResult> {
  if (signal?.aborted === true) return "timeout"
  if (isReady()) return "present"
  return await new Promise<SentinelWaitResult>((resolve) => {
    let settled = false
    let watcher: FSWatcher | undefined
    const finish = (result: SentinelWaitResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearInterval(recheck)
      signal?.removeEventListener("abort", onAbort)
      watcher?.close()
      resolve(result)
    }
    const onAbort = () => finish("timeout")
    // fs.watch can report the temporary rename source before the atomic destination is visible,
    // with no later event for the destination on Linux. Keep a bounded state recheck as fallback.
    const recheck = setInterval(() => {
      if (isReady()) finish("present")
    }, RUN_STATE_RECHECK_INTERVAL_MS)
    const timeout = setTimeout(() => finish("timeout"), Math.max(0, deadlineAt - now()))
    signal?.addEventListener("abort", onAbort, { once: true })
    try {
      watcher = watch(directory, () => {
        if (isReady()) finish("present")
      })
      watcher.once("error", () => {
        if (settled) return
        // The bounded state recheck remains authoritative when fs.watch is unavailable.
        watcher?.close()
        watcher = undefined
      })
    } catch {
      // The bounded state recheck remains authoritative when fs.watch is unavailable.
    }
    if (isReady()) finish("present")
  })
}

export async function waitForRunSentinel(
  path: string,
  deadlineAt: number,
  now: () => number,
  signal?: AbortSignal,
): Promise<SentinelWaitResult> {
  // Re-check on any event in the directory. Sentinels are published through writeRunJsonAtomic
  // (write temp, rename over), and Linux inotify reports only the rename SOURCE name, so matching
  // the sentinel's own basename never fires there and the wait degrades to a pure timeout.
  return waitForRunState(dirname(path), () => existsSync(path), deadlineAt, now, signal)
}

export async function waitForRunCompletion(
  outcomePath: string,
  launchPath: string,
  isMatchingOutcome: () => boolean,
  deadlineAt: number,
  now: () => number,
  signal?: AbortSignal,
): Promise<SentinelWaitResult> {
  return waitForRunState(
    dirname(outcomePath),
    () => existsSync(outcomePath) && !existsSync(launchPath) && isMatchingOutcome(),
    deadlineAt,
    now,
    signal,
  )
}
