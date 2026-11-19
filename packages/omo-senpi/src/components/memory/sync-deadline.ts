import type { SyncRunnerTimers } from "./sync-runner"

/** Settles with `work`'s value, or with "timeout" once `ms` pass first; the timer never outlives the race. */
export async function raceDeadline<T>(work: Promise<T>, ms: number, timers: SyncRunnerTimers): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<"timeout">((resolve) => {
    timer = timers.setTimeout(() => resolve("timeout"), ms)
    timer.unref?.()
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    timers.clearTimeout(timer)
  }
}
