import { existsSync, watch } from "node:fs"
import { dirname } from "node:path"

export type SentinelWaitResult = "present" | "timeout"

export async function waitForRunSentinel(
  path: string,
  deadlineAt: number,
  now: () => number,
): Promise<SentinelWaitResult> {
  if (existsSync(path)) return "present"
  return await new Promise<SentinelWaitResult>((resolve, reject) => {
    let settled = false
    // Re-check on any event in the directory. Sentinels are published through writeRunJsonAtomic
    // (write temp, rename over), and Linux inotify reports only the rename SOURCE name, so matching
    // the sentinel's own basename never fires there and the wait degrades to a pure timeout.
    const watcher = watch(dirname(path), () => {
      if (existsSync(path)) finish("present")
    })
    const timeout = setTimeout(() => finish("timeout"), Math.max(0, deadlineAt - now()))
    const finish = (result: SentinelWaitResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      watcher.close()
      resolve(result)
    }
    watcher.once("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      watcher.close()
      reject(error)
    })
    if (existsSync(path)) finish("present")
  })
}
